# Contributing

## Guidelines

1. **Client-side only**: PDF parsing and form operations run in the browser. Do not add remote network dependencies.
2. **Native ES modules**: There is no build or bundle step. Core dependencies (`pdf.js`, `pdf-lib`, `fontkit`, `lucide`) are in `/vendor/` and precached in `sw.js`.
3. **Standards compliance**: Exported PDFs must follow the ISO 32000 AcroForm specification.

## Development Setup

### Requirements

- Node.js >= 20.0.0
- npm >= 9.0.0
- Python 3.10+ (only for the optional `server.py` sidecar)

### Running locally

```sh
git clone https://github.com/sshrestha-design/formblatt.git
cd formblatt
npm install
npm start
```

Open `http://localhost:3000` in your browser.

## Testing

Run tests before submitting changes:

```sh
npm test              # unit tests and test suite
npm run test:unit     # detection unit tests
npm run test:detector # detector benchmarks
npm run bench         # speed benchmark
```

## Commit and Code Style

- **Commits**: Use concise descriptive sentences in the imperative mood (e.g. `Add Comb character cell support to AcroForm compiler`). Do not use conventional commit prefixes (`feat:`, `fix:`, `chore:`, `enhance:`).
- **Service Worker**: If you add or move static files under `js/`, update `STATIC_ASSETS` in `sw.js`.
- **License**: Contributions are licensed under AGPL-3.0-or-later.
