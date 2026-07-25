---
title: "Channels"
description: "Templates, delivery receipts, bounces, opt-outs."
source: "docs/spec/console.md"
---

#### 9.9 Channels

Two faces: in development the `console` driver makes every medium land in a built-in inbox instead of being sent; in production the panel is a deliverability console.

**The central decision is the taxonomy of "did not arrive" — seven states, not one:**

| State | Verdict | Action |
|---|---|---|
| Suppressed · opted out | **correct behaviour** | none |
| Suppressed · prior hard bounce | **correct, protective** | none |
| Blocked · invalid address | data error | fix the source |
| Soft bounce | transient | retry |
| Hard bounce | permanent | add to suppression |
| Provider error | transient | retry |
| Delivered then complained | worst outcome | review the template |

The first two rows carry the point: **suppression is not failure**. Counting it as failure sends you chasing healthy numbers while the harmful ones hide. Every row shows a verdict beside the count, because numbers alone do not produce action.

Weight follows consequence, not magnitude: four spam complaints are rendered more severely than fourteen hard bounces, because complaints burn sender reputation and take the whole channel down with them.

**Fallback chains are recorded as chains**, not outcomes: `via: [wa, sms]` stores "WhatsApp failed → SMS succeeded". This makes the fallback rate a **financial** metric — "23% of OTPs fell back this week, $38 above the WhatsApp-only cost" turns a technical note into an agenda item. Nobody measures this today.

Also here: locale resolution shown as a chain (user profile → `Accept-Language` → default), RTL-accurate template previews per locale, schema-bound template data, SPF/DKIM/DMARC verification, the suppression list, and masked recipients under the usual PII rules.
