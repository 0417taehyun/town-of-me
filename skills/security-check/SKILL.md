---
name: security-check
description: Perform evidence-based, read-only security checks of a repository or scoped path. Use when asked to inspect dependencies, security configuration, authentication or authorization, secrets, or data trust boundaries; do not use for automatic remediation.
---

# Security Check

Review the requested repository scope without changing files, installing packages, starting services, sending test traffic, or modifying external systems. Prefer existing project commands and already-installed tools. Never fix findings unless the user explicitly asks for fixes.

## Check the relevant surfaces

- **Dependencies:** inspect manifests and lockfiles for risky packages, unpinned sources, lifecycle scripts, and known advisories. Run an ecosystem audit only when its tool is already available and the command will not update project files.
- **Configuration:** inspect environment handling, secrets exposure, debug or production defaults, CORS/CSP and security headers, transport settings, build output, and deployment configuration.
- **Authentication and authorization:** trace identity creation, session or token validation, expiry and revocation, route protection, role or ownership checks, and privilege changes. Do not treat authentication as proof of authorization.
- **Data boundaries:** follow untrusted input from entry point through validation and transformation to storage, rendering, logging, filesystem, network, or command sinks. Consider injection, XSS, SSRF, path traversal, unsafe deserialization, uploads, and sensitive-data leakage where applicable.

Skip categories that are irrelevant to the scoped code and say why. Ignore generated files, vendored dependencies, and build artifacts unless they are the only evidence or are shipped directly.

## Evidence standard

For each reportable finding:

1. Cite the exact file and line or symbol.
2. Explain the attacker-controlled source, reachable path, security boundary, and impact.
3. Point to the missing or ineffective control and note any control that reduces severity.
4. Label confidence as `confirmed`, `likely`, or `needs verification`; do not present pattern matches as vulnerabilities.

Report severity, evidence, impact, and a concise recommendation. Separate findings from informational hardening notes. If no supported findings remain, say so and name the reviewed scope and any coverage gaps.

## Verification boundaries

Record every command actually run and its result. Static inspection, dependency metadata, lint output, and unit tests are not dynamic exploit verification. Claim runtime or dynamic verification only when it was actually performed in a representative environment, and state the environment and observed behavior. Never claim full security, exhaustive coverage, or absence of vulnerabilities.

If a useful check requires credentials, network access, package installation, service startup, destructive input, or any write, stop and request authorization or report it as an unverified follow-up. A request to review does not authorize remediation; propose fixes without editing until the user explicitly requests implementation.
