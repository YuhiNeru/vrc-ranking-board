# Security update verification: 2026-10-27

Scope: Brotli CVE-2026-111497, eMudhra/emSign trust incident and PHP2Shell CVE-2026-109618 / CVE-2026-109619.

## Changes

- No application dependency or source change was required; the shared PC runtime and/or VPS packages below were updated outside this repository.

VPS: Ubuntu libbrotli1 1.1.0-2ubuntu0.1 installed (vendor backport); ca-certificates 20260816ubuntu0.24.04.1 already removes the affected emSign roots. Ubuntu-managed Python 3.12.3-1ubuntu0.17 retained, using the OS CA bundle; upstream SPKI-level rejection is not independently confirmed. No collection budgets, databases or timers were changed.

Shared development PC: Node.js 24.22.1, Python.org 3.14.10, uv 0.13.6, pip 26.2.2, certifi 2026.10.23, Git for Windows 2.56.0.windows.4 (native Brotli 1.2.1), .NET 10.0.14 / 8.0.33 and WebView2 156.0.4314.50. These installations are machine changes, not files included in this commit.

## Validation and limits

Existing npm test and check passed; production scheduled service and timer report success.

Checks were run against the existing local working tree, which includes separately maintained changes. This commit intentionally contains only the security update and this record, preserving that other work. No PHP runtime or PHP application was found in the checked project and inspected PC/VPS environment. No exploit code was executed, TLS verification was not disabled, and repository visibility was not changed. Already installed copies on other PCs and provider-internal Cloudflare runtimes remain unverified. A normal HTTPS success alone is not evidence of rejecting the compromised key.

## Official references

- [Node.js security releases](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
- [Python security releases](https://blog.python.org/2026/10/python-3152-31410-31318-31216-31118/)
- [Ubuntu Brotli backport](https://ubuntu.com/security/CVE-2026-111497)
- [Git for Windows security release](https://github.com/git-for-windows/git/releases/tag/v2.56.0.windows.4)
- [PHP official changelog](https://www.php.net/ChangeLog-8.php)
