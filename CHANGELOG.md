# Changelog

All notable changes to Formblatt are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0] - 2026-10-01

### Added
- **Modular Detection Pipeline**: Split the auto-detector into independent stages under `js/engines/detection/` (AcroForm passthrough, vector geometry, table grids, underlines, visual affordances) with Non-Maximum Suppression (NMS).
- **Checkbox Group Semantics**: Mutual exclusion for paired `yes_no` checkboxes and multi-choice `enum` options in editor and exported PDFs.
- **OCR Token Sanitization**: Ported glyph scrubbing rules from DullyPDF to strip noise tokens (`0`, `6`, `[ ]`, `=`) from detected prompt labels.
- **Formula Engine**: Visual calculation builder compiling to AcroForm JavaScript (`/JS`) and calculation order catalogs (`/CO`).
- **Scanned Form Geometric Pipeline**: Bradley-Roth local adaptive binarization, horizontal underline detection, and contour extraction for scanned documents.
- **Table & Grid Builder**: Table tool with dynamic row/column addition, removal, and AcroForm grid cell embedding.
- **Offline PWA Execution**: Precached modular pipeline scripts in `sw.js` and added offline fallbacks bypassing remote CDNs when offline.
- **Standard OSS Files**: Added `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `CHANGELOG.md`.

### Changed
- **Relicensed to AGPLv3**: Changed license to GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`).
- **Node.js LTS Requirement**: Added `"engines": { "node": ">=20.0.0" }` in `package.json` for native `node --test` support.
- **Sidecar CORS Configuration**: Locked down the optional Python LayoutLMv3 sidecar (`server.py`) from wildcard `*` to `formblatt.dpdns.org` and local addresses (`localhost`, `127.0.0.1`).

---

## [1.5.0] - 2026-09-20

### Added
- **Comb Character Cell Detection**: Detection of boxed character combs with `isComb: true` and `/MaxLen` PDF flags.
- **Alignment Guides**: Snapping with distance indicators.
- **Inspector Number Inputs**: Wheel and drag scrubbing with focus-safe event handling.
- **Curtain Transition**: Progress transition for document processing.

### Fixed
- Constrained viewport pan drift within visible bounds.
- Handled radio group name collisions when multiple option sets appear on the same page.

---

## [1.0.0] - 2026-08-25

### Added
- **Initial Public Release**: Browser-based PDF form editor.
- Support for AcroForm field types: Text Field, Checkbox, Radio Button, Dropdown, Date Field, Signature.
- Client-side PDF reading and writing using vendored PDF.js and pdf-lib.
- Local project save and load using `.jform` JSON files.
- Keyboard shortcuts, undo/redo history, and selection overlays.
