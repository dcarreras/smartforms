# Auto-Detector Modular Refactoring Notes

## 1. Overview
The monolithic `js/engines/auto-detector.js` (~3,400 lines) was mechanically refactored into a cohesive, modular architecture under `js/engines/detection/` and `js/utils/geometry.js`. No heuristics, algorithms, regex patterns, or observable runtime behaviors were altered during extraction.

A backwards-compatibility shim remains at `js/engines/auto-detector.js` (`export * from "./detection/index.js";`) so that legacy consumers continue functioning without breaking changes.

---

## 2. Directory Structure & Module Responsibilities

```text
js/
├── engines/
│   ├── auto-detector.js          # Backwards-compatible re-export shim
│   └── detection/
│       ├── index.js              # Orchestrator, STAGES pipeline, detectFormFieldsFromDoc, autoDetectFields
│       ├── config.js             # DEDUP_THRESHOLDS, OVERLAP, COMB, RADIO_CLUSTER, SCAN_TRIGGER
│       ├── semantic-resolver.js  # resolveSemanticProps, isUniversalStaticText, GENERIC_PATTERNS
│       ├── acroform-passthrough.js # getExistingWidgetFields, importExistingAcroFormFields, detect()
│       ├── vector-shapes.js      # extractPdfVectorShapes, calculateDocumentColumnBoundaries
│       ├── comb-fields.js        # clusterCombBoxes
│       ├── radio-clustering.js   # clusterRadioGroups, MUTUAL_EXCLUSIVE_SETS
│       ├── vector-fields.js      # detectVectorDrawnFields, classifyRectAsField, attachNearestLabel, resolveFieldTypeFromShape, detect()
│       ├── table-grid.js         # detectLatticeTableFields, buildFieldsFromTableGrid, reconstructTableGridBoxes, TABLE_COL_DEFS, detect()
│       ├── underline-fields.js   # detectUnderlineFields, detect()
│       ├── neural-bridge.js      # enrichNeuralFieldsWithText, detect()
│       └── visual-affordances/
│           ├── index.js          # detectVisualAffordances, detectTaxScheduleLineAffordances, detectTaxSchedules, detect()
│           ├── checkbox-glyphs.js # detectCheckboxGlyphs, CHECKBOX_CHARS, CHECKBOX_REGEX
│           ├── colon-prompts.js  # detectColonPrompts
│           └── line-clustering.js # clusterIntoLines
└── utils/
    └── geometry.js               # isOverlapping, geometric IoU calculation
```

---

## 3. Uniform Stage Plugin Contract

All detection stages adhere to a standardized `detect(context)` contract:
- **Signature**: `detect(context: Object) => Promise<Array> | Array`
- **Context Properties**:
  - `page`: PDF.js page proxy or null
  - `viewport`: `{ width, height }`
  - `pageNum`: Page number (1-based)
  - `usedNames`: `Set<string>` of generated field names to avoid collisions
  - `existingFields`: Array of existing or user-authored fields
  - `widgetFields`: Array of authoritative AcroForm fields already discovered
  - `pageFields`: Array of fields detected on the current page so far
  - `rawBlocks`: Array of extracted text bounding blocks
  - `vectorShapes`: Vector rectangles, paths, checkboxes, and underlines
  - `boundaryLines`: Array of table grid lines
  - `options`: User or runtime options (OCR, sidecar, neural mode, etc.)
  - `sharedData`: Mutable bag for inter-stage communication (e.g. `latticeRegions`)

### Registered Core Stages (`STAGES`):
1. `"vector_geometry"`: Vector-drawn boxes, checkboxes, and comb cells (`vector-fields.js`)
2. `"lattice_tables"`: Table grid ruling lines and lattice cell fields (`table-grid.js`)
3. `"boundary_underlines"`: Underlines and signature baseline rules (`underline-fields.js`)
4. `"tax_schedules"`: Dotted-leader and financial schedule lines (`visual-affordances/index.js`)
5. `"visual_affordances"`: Text glyph checkboxes and colon prompt blanks (`visual-affordances/index.js`)

Optional extensions executed post-pipeline:
- `"layoutlmv3_sidecar"`: Optional local Python server inference
- `"onnx_neural"`: Optional in-browser ONNX Runtime vision model

---

## 4. Documented Refactoring Follow-Ups (`TODO(refactor-followup)`)

During the mechanical extraction, several non-breaking opportunities for future algorithmic refinement were flagged and marked with `// TODO(refactor-followup):`:

1. **`GENERIC_PATTERNS` Precedence (`semantic-resolver.js:8`):**
   - Several pattern keys in `GENERIC_PATTERNS` have overlapping regexes (e.g., `due_date` vs generic `date`, or `first_name` vs `name`). While the linear iteration order was preserved identically to ensure 100% characterization test compatibility, introducing explicit match weighting or sorting by pattern specificity would prevent edge-case ambiguity.

2. **Unicode Combining Marks in Slugify (`semantic-resolver.js:121`):**
   - The slugify fallback for non-Latin scripts strips non-alphanumeric characters. For Indic (Devanagari), Arabic, and Hebrew scripts, combining marks (`\p{M}`) are attached to base consonants. Supporting `\p{M}` without stripping diacritics will enhance slug generation for Indic/Asian localized forms.

3. **Sub-clustering in Vector Fields (`vector-fields.js:10`):**
   - In Phase 3, `classifyRectAsField`, `attachNearestLabel`, and `resolveFieldTypeFromShape` were successfully decomposed as top-level helpers. Further sub-clustering for comb fields vs general text boxes can be isolated into independent transformation passes.

4. **Visual Affordance Submodules (`visual-affordances/index.js:15`):**
   - In Phase 3, `checkbox-glyphs.js` and `colon-prompts.js` were extracted. The remaining stream-table heuristics inside `visual-affordances/index.js` can also be extracted into a dedicated `stream-tables.js` module in a future optimization pass.

---

## 5. Verification & Test Suite Pass Rate

- **Unit Test Runner**: `node test/run-unit-tests.js`
  - Tests: **78 / 78 Passing (100%)**
- **Application Test Suite**: `npm test`
  - Suites: 42
  - Tests: **224 / 224 Passing (100%)**
- External consumer imports updated in `editor-app.js`, `landing-controller.js`, and `onnx-detector.js`.
