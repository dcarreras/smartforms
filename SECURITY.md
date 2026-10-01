# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 2.x     | Yes       |
| < 2.0   | No        |

## Scope

Formblatt is a browser-based application that processes PDFs on the client using PDF.js and pdf-lib. Form data and files are processed in-browser and not uploaded to an external server.

The optional local Python sidecar (`server.py`) binds to localhost with CORS locked to `formblatt.dpdns.org` and local addresses (`localhost`, `127.0.0.1`).

## Reporting a Vulnerability

Report vulnerabilities privately using GitHub Security Advisories:
https://github.com/sshrestha-design/formblatt/security/advisories/new

If you cannot access GitHub Advisories, contact the maintainer directly:
- GitHub: [@sshrestha-design](https://github.com/sshrestha-design)
- Email: `security@formblatt.dpdns.org`

Include:
- Summary and impact
- Steps to reproduce or proof of concept
- Relevant environment details (browser, Node.js version, OS)

### Response Timeline

- Initial response: within 48 hours
- Status update: within 5 business days

Please do not open public issues for security vulnerabilities before a patch is released.
