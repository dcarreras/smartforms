# SmartForms
SmartForms is a web application for turning PDF documents into digital, fillable forms and exporting them as AcroForm files compatible with Acrobat, Preview, Chrome, and Edge.
The project is designed to work directly in the browser: PDFs are processed locally and are not uploaded to a server to create or edit form fields.
## Features
- Load PDF documents from your computer.
- Add text, date, list, checkbox, option group, and signature fields.
- Automatically detect drawn fields, tables, lines, and other document elements.
- Preserve existing AcroForm fields in partially fillable documents.
- Process scanned documents with OCR when needed.
- Use optional visual detection with ONNX Runtime Web.
- Export standard PDF forms and save editable projects.
- Run locally with a privacy-focused workflow.
## Privacy
SmartForms is designed to keep PDF content on the user's device during normal processing. The application does not need to upload a document to create form fields.
## Local development
The static application is located in the formblatt directory of this repository:
~~~sh
cd formblatt
npm install
npm start
~~~
Then open the local address provided by the server.
## Cloudflare Pages deployment
The Cloudflare Pages configuration is:
- Root directory: formblatt
- Build command: npm run build:pages
- Output directory: dist
- Production branch: main
The build command prepares a clean static copy of the frontend for deployment.
## Main structure
- formblatt/index.html: main application interface.
- formblatt/js/: editing, detection, and export logic.
- formblatt/models/: models used by browser-based detection features.
- formblatt/vendor/: frontend dependencies and runtime assets.
- formblatt/scripts/build-pages.cjs: prepares the content for Cloudflare Pages.
## Project status
SmartForms is an independent development based on Formblatt, adapted to its own goals, interface, and deployment workflow.
## License
See the LICENSE file for the applicable terms of use and distribution.
