# Formblatt

Browser-based editor that adds fillable fields (AcroForm) to a PDF. You open a PDF, place or auto-detect fields, and export a PDF that Acrobat, Preview, Chrome and Edge can fill in.

The PDF is read and written in the browser with PDF.js and pdf-lib. It is not uploaded anywhere.

Live: https://formblatt.dpdns.org

## What it does

- Places text, date, dropdown, checkbox, radio group and signature fields on any page
- Detects fields automatically from the PDF's drawn boxes, lines and text (see below)
- Reads existing AcroForm fields and keeps them, while detecting drawn fields on partially fillable forms
- Runs OCR on scanned pages when text is sparse so detection still has text to work with
- Exports a standard AcroForm PDF, and saves editable projects as `.jform` files
- Undo/redo, snapping, multi-select, duplicate with Alt+drag, keyboard shortcuts (press `?`)

## Auto-detection

Detection lives in `js/engines/detection/`. Candidates are gathered across stages and deduplicated using quality-dependent Non-Maximum Suppression (NMS) based on confidence and stage priority. A lower-scoring candidate that overlaps an accepted one is suppressed, while multi-stage agreements boost confidence.

| Step | File | Finds |
|---|---|---|
| 1. AcroForm passthrough | `acroform-passthrough.js` | Authoritative widgets already in the PDF. Kept as existing fields so partially fillable forms detect remaining drawn fields without overlap |
| 2. Vector geometry | `vector-fields.js`, `comb-fields.js`, `radio-clustering.js` | Drawn boxes, checkbox squares, character-cell (comb) rows, radio groups |
| 3. Table grids | `table-grid.js` | Cells in ruled tables |
| 4. Underlines | `underline-fields.js` | Blank lines next to a label, signature lines |
| 5. Tax schedules | `visual-affordances/index.js` | Line-numbered tax-style layouts |
| 6. Visual affordances | `visual-affordances/` | Checkbox glyphs (☐), `Label: ____` prompts |
| OCR (when needed) | `ocr-engine.js` | Text and lines from a rendered page image when extractable text is sparse (< 5 blocks); results cached per page |
| Optional | `onnx-detector.js`, `sidecar-detector.js` | Boxes from an ONNX model in the browser, or from a local LayoutLMv3 server |

Each field gets a type, a name and a dynamic `confidence` value computed from evidence:
- Clean geometric vector edge
- Matched label and semantic dictionary affinity
- Alignment with sibling fields in the same row or column
- Multi-stage agreement (e.g. vector geometry + visual affordance or neural vision)

Fields with confidence below 90% (`< 0.90`) are omitted from auto-detection. Names come from the nearest label, matched against Unicode-bounded patterns in `semantic-resolver.js` (with compound date and EIN precedence).

### Known limitations

- Label-to-name matching uses Unicode-bounded regexes (`(?<![\p{L}])…(?![\p{L}])`). Results outside the supported languages (English, German, French, Spanish, Italian, Portuguese, Dutch, Nepali/Hindi) fall back to slugified text.
- Size thresholds are in PDF points and were tuned on standard document form layouts.
- Core document detection (vector shapes, tables, underlines, comb cells, radio groups, and visual affordances) along with scanned document geometric OCR is 100% client-side and runs completely offline in Airplane Mode. Tesseract.js optical character recognition and in-browser ONNX vision are optional augmentations loaded on-demand from a CDN when online, and automatically fall back to the built-in 100% offline geometric engine when offline.

### Accuracy

<!-- Fill in from your dataset. Example layout: -->

| Dataset | PDFs | Fields | Precision | Recall | Type accuracy | Name accuracy |
|---|---|---|---|---|---|---|
| (name) | | | | | | |

Run the evaluation with `npm run test:detector`.

## Run locally

```sh
git clone https://github.com/sshrestha-design/formblatt
cd formblatt
npm install
npm start          # static server, see server.cjs for the port
```

No build step. The app is native ES modules.

### Optional: LayoutLMv3 server

Off by default. The editor probes `http://127.0.0.1:8000` and uses it if it responds.

```sh
python -m venv .venv
.venv/bin/pip install -r requirements.txt
npm run start:sidecar
```

## Tests

```sh
node test/run-unit-tests.js   # unit tests for each detection step
npm test                      # end-to-end regression test suite (224 tests)
npm run test:detector         # detector against a labelled dataset
npm run bench                 # timing benchmarks
```

## Layout

```
js/
  engines/
    detection/            detection steps, resolver, and orchestrator (index.js)
    acroform-builder.js   writes AcroForm fields with pdf-lib
    pdf-engine.js         PDF.js rendering
    ocr-engine.js         scanned-page OCR
    onnx-detector.js      optional browser model
    sidecar-detector.js   optional local server client
  core/                   state, undo/redo, project save/load, export
  controllers/            landing page and editor wiring
  ui/                     canvas, overlays, panels, signature pad
test/unit/                modular unit tests
tests/                    test suite and dataset benchmarks
server.py                 optional LayoutLMv3 server
server.cjs                static dev server
```

## Contributing

Bug reports with a sample PDF (or a description of its layout) are the most useful. For detection problems, include the page, the field you expected, and what the detector produced.

## License

GNU Affero General Public License v3.0 (AGPLv3). See [LICENSE](LICENSE) for details.
