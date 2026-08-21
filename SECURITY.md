# Security Policy

## Supported versions

Until 1.0, security fixes are provided for the latest published minor version.

## Reporting a vulnerability

Do not open a public issue for a vulnerability that could expose source code, local files, network services, or generated graph data. Use the repository's private security-advisory feature after the project is hosted on GitHub. Include affected versions, reproduction steps, impact, and any suggested mitigation.

## Security model

- Source analysis is local and does not currently call external AI services.
- The viewer binds to `127.0.0.1` by default.
- Graph JSON may contain repository paths, symbol names, endpoints, and architecture details. Treat it as potentially sensitive.
- Binding with `--host 0.0.0.0` is an explicit decision to expose the viewer to the local network.
- The HTTP server serves only bundled Viewer assets and the generated graph files supplied to it.

Please report path traversal, unintended file reads, command injection, unsafe browser opening, or analysis that executes repository code as security issues.
