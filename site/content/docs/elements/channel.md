---
title: "Channel"
description: "reaching humans — Email, SMS, WhatsApp, and push have physics Signal cannot express: consent, locale, receipts, and fallback chains."
source: "docs/spec/unified-theory.md"
---

Channel is the element for **reaching humans**.

Email, SMS, WhatsApp, and push have physics Signal cannot express: consent, locale, receipts, and fallback chains.

An element earns its place only if it has **irreducible physics**. New infrastructure becomes a new **driver** for an existing element — never a ninth element.

## At a glance

| Element | Replaces the zoo of | Essence |
|---|---|---|
| **Channel** | email · SMS · WhatsApp · push | reaching humans |

## Why this is an element

#### Why Channel is an element and not a library

Reaching a human has physics that machine messaging does not: localized templates, consent and opt-out, delivery receipts and bounces, and fallback chains across mediums. A Signal cannot express any of it. Hence the seventh element — and no eighth.

## Example from the teaching apps

Claimed fence from **provisions** — same source the doc-drift gate checks:

### `examples/provisions/src/channels.ts`

```typescript
import { channel } from "okengine";
import { z } from "zod";

export const mail = channel.email({ from: "Provisions <no-reply@provisions.sa>" });
export const sms  = channel.sms({ sender: "PROVISIONS" });
export const wa   = channel.whatsapp();

export const orderConfirmed = mail.template("order-confirmed", {
  schema: z.object({ name: z.string(), orderId: z.string(), total: z.number() }),
});

export const otpCode = channel.template("otp-code", {   // medium-agnostic
  schema: z.object({ code: z.string() }),
});
```

## Next

- [AI](/docs/elements/ai)
- [Introduction](/docs/get-started/introduction) — eight elements overview
- [Console](/docs/console/overview) — panels derived from the Manifest
