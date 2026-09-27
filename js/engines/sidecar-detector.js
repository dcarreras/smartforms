// ── Local Python LayoutLMv3 & Vision Sidecar Bridge (js/engines/sidecar-detector.js) ──
// Connects Formblatt to optional localhost Python server (uvicorn server:app --port 8000).
// 100% private: all inference runs locally on user's machine (CPU or Apple Silicon MPS).

import { generateFieldId } from "../core/state.js";

export const SIDECAR_CONFIG = {
    baseUrl: "http://127.0.0.1:8000",
    healthEndpoint: "http://127.0.0.1:8000/health",
    detectEndpoint: "http://127.0.0.1:8000/api/detect-fields",
    timeoutMs: 1500
};

let cachedSidecarStatus = null;
let lastHealthCheckTime = 0;

/**
 * Checks if the local Python sidecar is actively running on localhost:8000.
 * Caches result for 3 seconds to prevent excessive connection attempts.
 */
export async function isSidecarAvailable(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedSidecarStatus !== null && (now - lastHealthCheckTime < 3000)) {
        return cachedSidecarStatus;
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 600);

        const resp = await fetch(SIDECAR_CONFIG.healthEndpoint, {
            method: "GET",
            signal: controller.signal,
            headers: { "Accept": "application/json" }
        });
        clearTimeout(timeoutId);

        if (resp.ok) {
            const data = await resp.json();
            cachedSidecarStatus = {
                available: true,
                device: data.device || "cpu",
                service: data.service || "layoutlmv3-sidecar"
            };
        } else {
            cachedSidecarStatus = { available: false };
        }
    } catch {
        cachedSidecarStatus = { available: false };
    }

    lastHealthCheckTime = now;
    return cachedSidecarStatus;
}

/**
 * Calls the local sidecar to detect form fields on a PDF page.
 * Returns mapped Formblatt field objects if successful, or empty array if sidecar is offline.
 */
export async function detectFieldsViaSidecar(page, viewport, rawBlocks = [], pageNum = 1, usedNames = new Set()) {
    try {
        const status = await isSidecarAvailable();
        if (!status || !status.available) {
            return [];
        }

        // Format tokens for LayoutLMv3
        const tokens = rawBlocks.map(tb => ({
            text: tb.str || "",
            box: [tb.x, tb.y, tb.width, tb.height]
        }));

        const payload = {
            width: viewport.width || 612,
            height: viewport.height || 792,
            tokens: tokens,
            page: pageNum
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), SIDECAR_CONFIG.timeoutMs);

        const response = await fetch(SIDECAR_CONFIG.detectEndpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            console.warn(`[Sidecar] Local server responded with status ${response.status}`);
            return [];
        }

        const data = await response.json();
        if (!data || !Array.isArray(data.fields)) {
            return [];
        }

        // Map sidecar fields to Formblatt schema
        const mappedFields = [];
        for (const f of data.fields) {
            let uniqueName = f.name || `field_${pageNum}_${mappedFields.length + 1}`;
            let suffix = 1;
            while (usedNames.has(uniqueName)) {
                suffix++;
                uniqueName = `${f.name || "field"}_${suffix}`;
            }
            usedNames.add(uniqueName);

            mappedFields.push({
                id: generateFieldId(),
                name: uniqueName,
                type: f.type || "textField",
                x: Math.round(f.x),
                y: Math.round(f.y),
                width: Math.max(12, Math.round(f.width)),
                height: Math.max(12, Math.round(f.height)),
                page: pageNum,
                value: "",
                confidence: f.confidence || 0.9,
                detectedBy: "layoutlmv3_sidecar",
                tooltip: f.label || uniqueName,
                required: false,
                readOnly: false
            });
        }

        return mappedFields;
    } catch (err) {
        console.warn("[Sidecar] Inference skipped, using client-side auto-detector:", err.message);
        return [];
    }
}
