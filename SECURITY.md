# Security Policy

## Supported versions

okengine is pre-1.0 (`v0.x`). Breaking changes are expected until a stable
release (see the README warning and changelog).

| Version                        | Security fixes |
| ------------------------------ | -------------- |
| Latest `main` / newest release | Yes            |
| Older tags and published lines | No             |

There is no multi-version LTS matrix. Fixes land on `main` and ship in the
next published release only — older releases are not backported.

## Reporting a vulnerability

**Do not** open a public GitHub issue, discussion, or pull request for a
security vulnerability.

**Preferred:** GitHub
[private vulnerability reporting](https://github.com/omqkhafi/okengine/security/advisories/new)
for this repository (Security → Advisories → Report a vulnerability). That
keeps the report confidential, creates a draft advisory the maintainer can
triage in-repo, and avoids accidental public disclosure.

**Fallback** (if the Report button is unavailable): email
`omqkhafi@gmail.com` with subject prefix `[SECURITY]`. This is the live
maintainer inbox used while the project is small / solo-maintained.

### What to include

- Affected version, tag, or commit SHA
- Why you believe the issue is security-sensitive
- Steps to reproduce or a proof of concept
- Suspected impact (e.g. cross-tenant read, auth bypass, secret exposure)
- Suggested mitigation or fix, if you have one

### In scope

Security-relevant defects in okengine’s shipped boundaries, including:

- **Store RLS / tenant isolation** — cross-tenant reads or writes,
  `oke.tenant()` / RLS helper bypass
- **Vault** — secret encryption, master-key rotation, ciphertext or plaintext
  leakage across tenants or planes
- **API keys** — HMAC verification failures, scope attenuation bypass,
  privilege escalation via keys
- **Gate auth / sessions** — authentication or authorization bypass, session
  reuse or fixation, policy / rate-gate failures with security impact
- **Signal live client** — reconnect / `autoResubscribe` resource-exhaustion
  (tight-loop) class issues against the live SSE surface
- **Console & MCP (operator plane)** — Host/Origin (DNS-rebinding class)
  checks, XSS/CSP failures, MCP authorization / confused-deputy risks, and
  secret or classified-PII reveal paths

### Out of scope

- Public feature requests, non-security bugs, and dependency advisories with
  no demonstrated impact on okengine’s boundaries (report those upstream or
  as ordinary issues when appropriate)
- Attacks that require already-compromised operator credentials, physical
  access, or control of the host the reporter does not own
- Purely theoretical issues without a practical reproduction path

### Response expectations

This project is presently small / solo-maintained. There is no 24/7 security
desk and **no guaranteed SLA**.

- Aim to **acknowledge** private reports within about **7 days**
- Validated issues are prioritized by severity; fixes land on `main` and the
  next release when ready
- Coordinated disclosure via a published GitHub Security Advisory when a fix
  is ready to share

Thank you for helping keep okengine and its users safer.
