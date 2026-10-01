// ── Formblatt CLI Form Detection Benchmark & Evaluation Runner ────────
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as PDFLib from 'pdf-lib';
import { generateEmployeeOnboardingPdf, generateMedicalIntakePdf, generateCommercialInvoicePdf } from './generate_test_pdfs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEB_DIR = path.resolve(__dirname, '..');

globalThis.PDFLib = PDFLib;
global.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
};
global.window = { PDFLib, localStorage: global.localStorage, location: { hash: "" } };
global.document = {
    getElementById: () => null,
    createElement: (tag) => ({
        style: {},
        classList: { add: () => {}, remove: () => {} },
        appendChild: () => {},
        addEventListener: () => {},
        getContext: () => ({
            getImageData: () => ({ data: new Uint8ClampedArray(100) }),
            putImageData: () => {},
            drawImage: () => {},
            fillRect: () => {},
            clearRect: () => {},
            strokeRect: () => {}
        })
    }),
    querySelectorAll: () => []
};

import zlib from 'zlib';

async function runCliEvaluation() {
    console.log("=================================================");
    console.log("📊 FORMBLATT FORM FIELD DETECTION BENCHMARK SUITE");
    console.log("=================================================\n");

    const { state } = await import(path.join(WEB_DIR, 'js', 'core', 'state.js'));
    const { autoDetectFields, extractPdfVectorShapes, detectVectorDrawnFields } = await import(path.join(WEB_DIR, 'js', 'engines', 'auto-detector.js'));

    const testSuites = [
        {
            name: "Employee Onboarding & Direct Deposit",
            generate: generateEmployeeOnboardingPdf,
            expectedMinFields: 10,
            expectedKeywords: ["name", "dob", "ssn", "phone", "email", "signature", "date"]
        },
        {
            name: "Medical Clinic Intake & Health History",
            generate: generateMedicalIntakePdf,
            expectedMinFields: 12,
            expectedKeywords: ["name", "dob", "phone", "allergies", "medications", "signature", "date"]
        },
        {
            name: "Commercial Service Invoice",
            generate: generateCommercialInvoicePdf,
            expectedMinFields: 15,
            expectedKeywords: ["invoice", "date", "due_date", "subtotal", "tax", "total", "signature"]
        }
    ];

    const results = [];

    for (const test of testSuites) {
        console.log(`🔍 Testing: ${test.name}...`);
        const pdfBytes = await test.generate();

        // Load into mock PDF doc structure for detector
        const pdfDoc = await PDFLib.PDFDocument.load(pdfBytes);
        const pageCount = pdfDoc.getPageCount();

        state.pdfBytes = pdfBytes;
        state.totalPages = pageCount;
        state.currentPageNum = 1;
        state.fields = [];

        // Mock PDF.js page structure with real content stream extraction
        state.pdfDoc = {
            numPages: pageCount,
            getPage: async (num) => {
                const p = pdfDoc.getPage(num - 1);
                const { width, height } = p.getSize();
                
                const fnArray = [];
                const argsArray = [];
                const textItems = [];

                try {
                    const contents = p.node.Contents();
                    const arr = contents ? (contents.asArray ? contents.asArray() : [contents]) : [];
                    for (const ref of arr) {
                        const s = pdfDoc.context.lookup(ref);
                        if (!s || !s.getContents) continue;
                        let raw = s.getContents();
                        let text = "";
                        try { text = new TextDecoder().decode(zlib.inflateSync(raw)); } catch(e) { text = new TextDecoder().decode(raw); }

                        const tokens = text.split(/\s+/);
                        let curMatrix = [1, 0, 0, 1, 0, 0];
                        let curFontSize = 10;

                        for (let i = 0; i < tokens.length; i++) {
                            const t = tokens[i];
                            if (t === "q") {
                                fnArray.push(1); // save
                                argsArray.push([]);
                            } else if (t === "Q") {
                                fnArray.push(2); // restore
                                argsArray.push([]);
                            } else if (t === "cm" && i >= 6) {
                                fnArray.push(3); // transform
                                argsArray.push([parseFloat(tokens[i-6]), parseFloat(tokens[i-5]), parseFloat(tokens[i-4]), parseFloat(tokens[i-3]), parseFloat(tokens[i-2]), parseFloat(tokens[i-1])]);
                            } else if (t === "m" && i >= 2) {
                                fnArray.push(13); // moveTo
                                argsArray.push([parseFloat(tokens[i-2]), parseFloat(tokens[i-1])]);
                            } else if (t === "l" && i >= 2) {
                                fnArray.push(14); // lineTo
                                argsArray.push([parseFloat(tokens[i-2]), parseFloat(tokens[i-1])]);
                            } else if (t === "h") {
                                fnArray.push(18); // closePath
                                argsArray.push([]);
                            } else if (t === "re" && i >= 4) {
                                fnArray.push(19); // rectangle
                                argsArray.push([parseFloat(tokens[i-4]), parseFloat(tokens[i-3]), parseFloat(tokens[i-2]), parseFloat(tokens[i-1])]);
                            } else if (t === "Tm" && i >= 6) {
                                curMatrix = [parseFloat(tokens[i-6]), parseFloat(tokens[i-5]), parseFloat(tokens[i-4]), parseFloat(tokens[i-3]), parseFloat(tokens[i-2]), parseFloat(tokens[i-1])];
                            } else if (t === "Tf" && i >= 2) {
                                curFontSize = parseFloat(tokens[i-1]) || 10;
                            } else if (t === "Tj" && i >= 1) {
                                const token = tokens[i-1];
                                let str = "";
                                if (token.startsWith("<") && token.endsWith(">")) {
                                    str = Buffer.from(token.slice(1, -1), "hex").toString("utf8");
                                } else if (token.startsWith("(") && token.endsWith(")")) {
                                    str = token.slice(1, -1);
                                }
                                if (str) {
                                    const tx = curMatrix[4];
                                    const ty = curMatrix[5];
                                    textItems.push({
                                        str,
                                        transform: [1, 0, 0, 1, tx, ty],
                                        x: Math.round(tx),
                                        y: Math.round(height - ty - curFontSize),
                                        width: Math.round(str.length * (curFontSize * 0.55)),
                                        height: Math.round(curFontSize)
                                    });
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.warn("Stream parse error:", e);
                }

                return {
                    getViewport: ({ scale = 1 }) => ({
                        width: width * scale,
                        height: height * scale,
                        convertToViewportPoint: (x, y) => [x * scale, (height - y) * scale]
                    }),
                    getAnnotations: async () => [],
                    getTextContent: async () => ({ items: textItems }),
                    getOperatorList: async () => ({ fnArray, argsArray }),
                    render: () => ({ promise: Promise.resolve() })
                };
            }
        };

        const count = await autoDetectFields("current");
        console.log(`   • Fields Detected : ${state.fields.length}`);

        results.push({
            name: test.name,
            detected: state.fields.length,
            fields: state.fields.map(f => ({ name: f.name, type: f.type, x: f.x, y: f.y, w: f.width, h: f.height }))
        });
    }

    console.log("\n=================================================");
    console.log("📈 EVALUATION SUMMARY TABLE");
    console.log("=================================================");
    console.table(results.map(r => ({
        "Benchmark Document": r.name,
        "Detections Count": r.detected
    })));

    console.log("\n💡 To visually inspect, mark right/wrong, and calculate live Precision/Recall/F1 scores, open:");
    console.log("👉 /evaluate.html or /tests/evaluate.html in your web browser.\n");
}

runCliEvaluation().catch(err => {
    console.error("Evaluation error:", err);
});
