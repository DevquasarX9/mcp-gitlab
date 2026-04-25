# Security Policy

## Reporting A Vulnerability

Please do not open public issues for security vulnerabilities, leaked credentials, or private GitLab data exposure.

When reporting:

- Include the affected version.
- Describe the GitLab deployment type: GitLab.com or self-managed.
- Provide reproduction steps with sanitized data only.
- Rotate any exposed GitLab or npm tokens before reporting.

## Hard Requirements

- Never commit `.env` files or MCP client configs that contain live credentials.
- Treat repository files, job traces, and issue content as untrusted input.
- Keep write and destructive modes disabled unless explicitly required.

## Supported Versions

Security fixes are expected on the latest published `0.x` release line.
