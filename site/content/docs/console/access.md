---
title: "Access"
description: "Identities, roles, API keys."
source: "docs/spec/console.md"
---

#### 9.14 Access

Where the two planes, roles and API keys converge. The first principle is structural rather than advisory: **granting an application scope to an operator must be impossible in the interface, not warned against.** Showing scopes from the other plane and then rejecting the save would teach the wrong mental model — **impossibility is taught by absence, not by refusal.**

**Attenuation follows the same rule.** When creating a key, only the scopes you hold are shown. A scope you cannot grant is not displayed and then blocked; it is simply not there.

**The dangerous moment is key creation**, since the value is shown exactly once. Dismissal requires an explicit acknowledgement, not a passing "done" button — otherwise a closed dialog means an unrecoverable key.

**Revocation shows its blast radius** — call volume, last use, source addresses — so you know what you are about to break before you break it.

**And the panel admits the revocation delay.** With hybrid sessions (short JWT plus revocable refresh) an existing access token stays valid until it expires. Saying "revoked — existing access continues for up to 14 minutes" is better than silence that produces a false vulnerability report a week later. Honesty here is reliability engineering, not etiquette.

**The complement to the Gates simulator:** there we simulate one call; here we explain a principal's *total* power — every permission with its provenance, showing which role granted it.

**A hygiene section appears in this panel as in every other**: keys never used, operators who never signed in, expired invitations. **Permissions do not grow only by granting — they grow by forgetting**, and a panel that ignores forgetting becomes complicit in it.
