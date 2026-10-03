// ── Local Python LayoutLMv3 & Vision Sidecar Bridge (js/engines/sidecar-detector.js) ──
// Connects Formblatt to optional localhost Python server (uvicorn server:app --port 8000).
// 100% private: all inference runs locally on user's machine (CPU or Apple Silicon MPS).

import { generateFieldId } from "../core/state.js";
import { attachNearestLabel } from "./detection/vector-fields.js";
import { resolveSemanticProps } from "./detection/semantic-resolver.js";

export const SIDECAR_CONFIG = {
    baseUrl: "http://127.0.0.1:8000",
    healthEndpoint: "http://127.0.0.1:8000/health",
    detectEndpoint: "http://127.0.0.1:8000/api/detect-fields",
    timeoutMs: 25000
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
        const timeoutId = setTimeout(() => controller.abort(), 1200);

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
                service: data.service || "layoutlmv3-sidecar",
                engine: data.engine || "ffdnet-l"
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

        // Render page to offscreen canvas to send image to FFDNet-L vision model
        let imageBase64 = null;
        if (page && typeof document !== "undefined") {
            try {
                const renderCanvas = document.createElement("canvas");
                const scale = 1.5;
                const renderViewport = page.getViewport ? page.getViewport({ scale }) : viewport;
                renderCanvas.width = renderViewport.width;
                renderCanvas.height = renderViewport.height;
                const renderCtx = renderCanvas.getContext("2d");
                if (page.render) {
                    await page.render({ canvasContext: renderCtx, viewport: renderViewport }).promise;
                    imageBase64 = renderCanvas.toDataURL("image/jpeg", 0.88);
                }
            } catch (canvasErr) {
                console.warn("[Sidecar] Canvas rendering warning:", canvasErr);
            }
        }

        // Format tokens for LayoutLMv3 / text reference
        const tokens = rawBlocks.map(tb => ({
            text: tb.str || "",
            box: [tb.x, tb.y, tb.width, tb.height]
        }));

        const payload = {
            image: imageBase64,
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

        // Map sidecar fields to Formblatt schema and bind accurate text labels
        const mappedFields = [];
        for (const f of data.fields) {
            const box = {
                x: Math.round(f.x),
                y: Math.round(f.y),
                width: Math.max(12, Math.round(f.width)),
                height: Math.max(12, Math.round(f.height)),
                type: f.type || "textField"
            };

            // Derive nearest label and semantic name from rawBlocks
            let labelText = (f.label || "").trim();
            const isGenericLabel = !labelText ||
                /^(?:textbox|choice_button|choicebutton|field|signature)_\d+$/i.test(labelText) ||
                /^(?:textbox|choice button|field|signature)$/i.test(labelText);

            if (isGenericLabel && rawBlocks.length > 0) {
                try {
                    const labelInfo = attachNearestLabel(box, rawBlocks, [], [], pageNum);
                    if (labelInfo && labelInfo.labelText) {
                        labelText = labelInfo.labelText;
                    }
                } catch (labelErr) {
                    console.warn("[Sidecar] Label attachment error:", labelErr);
                }
            }

            const sem = resolveSemanticProps(labelText, box.type, usedNames);
            const finalName = sem.name || f.name || `field_${pageNum}_${mappedFields.length + 1}`;
            usedNames.add(finalName);

            mappedFields.push({
                id: generateFieldId(),
                name: finalName,
                type: box.type || sem.type || "textField",
                x: box.x,
                y: box.y,
                width: box.width,
                height: box.height,
                page: pageNum,
                value: "",
                borderStyle: "none",
                fillStyle: "transparent",
                borderWidth: 0,
                confidence: typeof f.confidence === "number" ? f.confidence : 0.85,
                detectedBy: "ffdnet-l",
                label: labelText || sem.label || finalName,
                tooltip: labelText || sem.label || finalName,
                dataFormat: sem.dataFormat || "text",
                autofill: sem.autofill || "",
                radioGroup: f.radioGroup,
                exportValue: f.exportValue,
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
