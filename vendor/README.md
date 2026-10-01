# Vendored Third-Party Assets (`vendor/`)

This directory contains standalone, client-side JavaScript libraries bundled with Formblatt to enable zero-telemetry, 100% offline document editing and ISO 32000 AcroForm generation.

## Included Core Vendor Assets

These assets are committed to the repository and cached by the service worker (`sw.js`) for offline execution in Airplane Mode:

| File | Purpose | Source / Upstream |
|---|---|---|
| `pdf.min.js` | PDF rendering and document parsing | Mozilla PDF.js v3.4.120 |
| `pdf.worker.min.js` | Background worker for PDF parsing | Mozilla PDF.js v3.4.120 |
| `pdf-lib.min.js` | Client-side AcroForm compilation & PDF export | PDF-Lib v1.17.1 |
| `fontkit.umd.min.js` | TrueType/OpenType font embedding & glyph subsetting | Fontkit |
| `lucide.min.js` | UI icons for editor toolbars and panels | Lucide Icons |

---

## Optional Offline AI & OCR Assets (Self-Hosting)

Formblatt includes optional client-side augmentations (Tesseract.js for scanned bitmap OCR and ONNX Runtime Web for neural vision). When running online, these load dynamically on demand via CDN. 

If you require **100% air-gapped / offline operation without CDN requests**, place the following binary assets in their respective directories:

### 1. Tesseract.js (Optical Character Recognition)
- **Path**: `vendor/tesseract.esm.min.js`
- **Upstream**: [Tesseract.js v5](https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js)
- **Usage**: When present, `js/engines/ocr-engine.js` loads the local worker module rather than requesting jsDelivr CDN.

### 2. ONNX Runtime Web (In-Browser Neural Vision)
- **Path**: `vendor/ort.all.min.js`
- **Upstream**: [onnxruntime-web v1.19.2](https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort.all.min.js)
- **Usage**: When present, `js/engines/onnx-detector.js` initializes the local WASM/WebGPU runtime.

### 3. Neural Detector Model Weights
- **Path**: `models/ffdnet_s_quantized.onnx`
- **Usage**: The quantized ONNX model file evaluated by `js/engines/onnx-detector.js`.
