import { state } from "../core/state.js";
import { autoDetectFields } from "./detection/index.js";

const nextTick = () => new Promise(resolve => setTimeout(resolve, 0));

export function resetDocumentDetection(totalPages = state.totalPages) {
    const runId = (state.documentDetection?.runId || 0) + 1;
    state.documentDetection = {
        status: "idle",
        totalPages,
        currentPage: 0,
        completedPages: [],
        failedPages: [],
        fieldsAdded: 0,
        cancelRequested: false,
        runId,
        message: ""
    };
    return state.documentDetection;
}

export function cancelDocumentDetection() {
    if (state.documentDetection?.status === "running") {
        state.documentDetection.cancelRequested = true;
        state.documentDetection.message = "Stopping after the current page…";
    }
}

export function getPendingDocumentDetectionPages(job = state.documentDetection) {
    const done = new Set([...(job?.completedPages || []), ...(job?.failedPages || []).map(item => item.pageNumber)]);
    return Array.from({ length: job?.totalPages || 0 }, (_, index) => index + 1).filter(page => !done.has(page));
}

export async function startDocumentDetection({ onUpdate, detectPage } = {}) {
    if (!state.pdfDoc) return state.documentDetection;

    let job = state.documentDetection;
    if (!job || job.totalPages !== state.totalPages) job = resetDocumentDetection(state.totalPages);
    if (job.status === "running") return job;

    const runId = job.runId;
    const pdfDoc = state.pdfDoc;
    const isCurrentRun = () => state.documentDetection?.runId === runId
        && state.pdfDoc === pdfDoc;
    const pages = getPendingDocumentDetectionPages(job);
    if (!pages.length) {
        job.status = job.failedPages.length ? "complete-with-errors" : "complete";
        onUpdate?.(job);
        return job;
    }

    job.status = "running";
    job.cancelRequested = false;
    job.message = "Preparing document analysis…";
    onUpdate?.(job);

    const scanPage = detectPage || (pageNum => autoDetectFields("current", {
        pageNumbers: [pageNum],
        mode: "hybrid",
        useNeural: true,
        shouldCommit: isCurrentRun,
        onProgress: (message) => {
            if (!isCurrentRun()) return;
            job.message = message;
            onUpdate?.(job);
        }
    }));

    for (const pageNum of pages) {
        if (!isCurrentRun() || job.cancelRequested) break;
        job.currentPage = pageNum;
        job.message = `Analyzing page ${pageNum} of ${job.totalPages}…`;
        onUpdate?.(job);

        try {
            const result = await scanPage(pageNum);
            if (!isCurrentRun()) break;
            const pageError = result?.pageErrors?.find(error => error.pageNumber === pageNum);
            if (pageError) throw new Error(pageError.message);
            job.completedPages.push(pageNum);
            job.fieldsAdded += Number(result?.totalCount || result || 0);
        } catch (error) {
            job.failedPages.push({ pageNumber: pageNum, message: error?.message || String(error) });
            console.error(`Document detection failed on page ${pageNum}:`, error);
        }
        onUpdate?.(job);
        await nextTick();
    }

    if (state.documentDetection?.runId === runId) {
        job.currentPage = 0;
        job.status = job.cancelRequested
            ? "cancelled"
            : job.failedPages.length ? "complete-with-errors" : "complete";
        job.message = job.cancelRequested
            ? "Analysis paused. Completed pages are kept."
            : job.failedPages.length
                ? `Finished with ${job.failedPages.length} page error${job.failedPages.length === 1 ? "" : "s"}.`
                : "All pages analyzed.";
        onUpdate?.(job);
    }
    return job;
}
