import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { state } from "../../../js/core/state.js";
import {
    cancelDocumentDetection,
    getPendingDocumentDetectionPages,
    resetDocumentDetection,
    startDocumentDetection
} from "../../../js/engines/document-detection.js";

afterEach(() => {
    state.pdfDoc = null;
    state.totalPages = 1;
    resetDocumentDetection(0);
});

describe("document detection job", () => {
    it("processes pages sequentially and records fields as each page finishes", async () => {
        state.pdfDoc = {};
        state.totalPages = 3;
        const job = resetDocumentDetection(3);
        const visited = [];

        await startDocumentDetection({
            detectPage: async page => {
                visited.push(page);
                return { totalCount: page };
            }
        });

        assert.deepEqual(visited, [1, 2, 3]);
        assert.deepEqual(job.completedPages, [1, 2, 3]);
        assert.equal(job.fieldsAdded, 6);
        assert.equal(job.status, "complete");
    });

    it("keeps completed pages when cancelled and resumes only remaining pages", async () => {
        state.pdfDoc = {};
        state.totalPages = 3;
        const job = resetDocumentDetection(3);
        const firstRun = [];

        await startDocumentDetection({
            detectPage: async page => {
                firstRun.push(page);
                if (page === 1) cancelDocumentDetection();
                return { totalCount: 1 };
            }
        });

        assert.equal(job.status, "cancelled");
        assert.deepEqual(job.completedPages, [1]);
        assert.deepEqual(getPendingDocumentDetectionPages(job), [2, 3]);

        const resumed = [];
        await startDocumentDetection({ detectPage: async page => { resumed.push(page); return { totalCount: 1 }; } });
        assert.deepEqual(resumed, [2, 3]);
        assert.deepEqual(job.completedPages, [1, 2, 3]);
        assert.equal(job.status, "complete");
    });

    it("continues after an isolated page failure", async () => {
        state.pdfDoc = {};
        state.totalPages = 3;
        const job = resetDocumentDetection(3);
        const visited = [];

        await startDocumentDetection({
            detectPage: async page => {
                visited.push(page);
                if (page === 2) throw new Error("Unreadable page");
                return { totalCount: 1 };
            }
        });

        assert.deepEqual(visited, [1, 2, 3]);
        assert.deepEqual(job.completedPages, [1, 3]);
        assert.deepEqual(job.failedPages, [{ pageNumber: 2, message: "Unreadable page" }]);
        assert.equal(job.status, "complete-with-errors");
    });

    it("does not apply a superseded run after its current page finishes", async () => {
        state.pdfDoc = {};
        state.totalPages = 2;
        const job = resetDocumentDetection(2);
        let releasePage;
        const pendingPage = new Promise(resolve => { releasePage = resolve; });

        const running = startDocumentDetection({
            detectPage: async () => {
                await pendingPage;
                return { totalCount: 1 };
            }
        });

        await new Promise(resolve => setTimeout(resolve, 0));
        state.pdfDoc = {};
        state.totalPages = 1;
        const replacement = resetDocumentDetection(1);
        releasePage();
        await running;

        assert.deepEqual(job.completedPages, []);
        assert.equal(replacement.status, "idle");
        assert.deepEqual(replacement.completedPages, []);
    });
});
