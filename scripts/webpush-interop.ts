/**
 * End-to-end Web Push check through okengine's Channel element.
 *
 * Validates:
 *   Channel runtime → webpush driver → createPushSender → WebPushTransport
 * against a real browser push service (not sently's standalone send harness).
 *
 * Subscribe first with sently's browser page (do not rebuild it here):
 *   ../sently/examples/webpush-interop/index.html + sw.js
 *
 * Env:
 *   VAPID_PUBLIC_KEY   — same key pasted into the browser subscribe page
 *   VAPID_PRIVATE_KEY  — matching private key
 *   VAPID_SUBJECT      — mailto: or https: with a real domain
 *                        (default mailto:webpush-interop@example.com;
 *                        Apple rejects @localhost / @oke.local → BadJwtToken)
 *
 * Usage:
 *   bun scripts/webpush-interop.ts path/to/subscription.json
 *   bun scripts/webpush-interop.ts '{"endpoint":"...","keys":{...}}'
 *   cat subscription.json | bun scripts/webpush-interop.ts -
 */
import { channel, createChannelRuntime } from "../src/elements/channel.ts";
import { openWebPushChannel } from "../src/drivers/channel-webpush.ts";

type PushSub = {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
};

function usage(): never {
  console.error(`Usage:
  bun scripts/webpush-interop.ts <subscription.json|-|'{"endpoint":...}'>

Required env (same VAPID pair used when subscribing in the browser):
  VAPID_PUBLIC_KEY
  VAPID_PRIVATE_KEY

Optional env:
  VAPID_SUBJECT   (default: mailto:webpush-interop@example.com)
                  Apple requires a real domain — not @localhost / @oke.local

Subscribe with sently's page (sibling repo):
  cd ../sently/examples/webpush-interop && bunx --bun serve .
  # paste VAPID_PUBLIC_KEY → Subscribe → copy PushSubscription JSON
`);
  process.exit(1);
}

async function readSubscriptionArg(arg: string): Promise<string> {
  if (arg === "-") {
    return new Response(Bun.stdin).text();
  }
  if (arg.trimStart().startsWith("{")) {
    return arg;
  }
  return Bun.file(arg).text();
}

function parseSubscription(raw: string): PushSub {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Subscription must be a JSON object");
  }

  const obj = parsed as Record<string, unknown>;
  const keys = obj.keys;
  if (typeof obj.endpoint !== "string" || !obj.endpoint) {
    throw new Error('Subscription missing string "endpoint"');
  }
  if (!keys || typeof keys !== "object") {
    throw new Error('Subscription missing "keys" object');
  }
  const k = keys as Record<string, unknown>;
  if (typeof k.p256dh !== "string" || typeof k.auth !== "string") {
    throw new Error('Subscription.keys must include string "p256dh" and "auth"');
  }

  return {
    endpoint: obj.endpoint,
    keys: { p256dh: k.p256dh, auth: k.auth },
  };
}

/** Log the push-service HTTP exchange (status / headers / body) without bypassing Channel. */
function installFetchLogger(): void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await originalFetch(input, init);
    const clone = response.clone();
    const bodyText = await clone.text().catch(() => "");

    console.log("\n--- Push service HTTP response ---");
    console.log(`${response.status} ${response.statusText}`);
    for (const [name, value] of response.headers) {
      console.log(`${name}: ${value}`);
    }
    console.log("");
    console.log(bodyText.length > 0 ? bodyText : "(empty body)");
    console.log("----------------------------------\n");

    return response;
  }) as typeof fetch;
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) usage();

  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const vapidSubject = process.env.VAPID_SUBJECT?.trim() || "mailto:webpush-interop@example.com";

  if (!vapidPublicKey || !vapidPrivateKey) {
    console.error("Missing VAPID_PUBLIC_KEY and/or VAPID_PRIVATE_KEY.");
    usage();
  }

  const subscription = parseSubscription(await readSubscriptionArg(arg));
  installFetchLogger();

  const push = channel.push();
  const ping = push.template("webpush-interop-ping", {
    description: "Manual Web Push interop ping",
    locales: ["en"],
  });

  const driver = openWebPushChannel({
    vapidPublicKey,
    vapidPrivateKey,
    vapidSubject,
  });

  const runtime = createChannelRuntime({
    templates: [ping],
    drivers: [driver],
    catalog: {
      "webpush-interop-ping": {
        en: {
          subject: "okengine webpush interop",
          text: "Hello from okengine Channel at {{when}}",
        },
      },
    },
  });

  console.log("Sending via okengine Channel (webpush driver)…");
  console.log(`  endpoint origin: ${new URL(subscription.endpoint).origin}`);
  console.log(`  VAPID subject:   ${vapidSubject}`);
  console.log(
    "  path: ChannelRuntime.send → openWebPushChannel → createPushSender → WebPushTransport",
  );

  const result = await runtime.send("webpush-interop-ping", {
    to: subscription.endpoint,
    pushSubscription: subscription,
    data: {
      when: new Date().toISOString(),
      source: "scripts/webpush-interop.ts",
    },
  });

  console.log("ChannelRuntime.send() result:");
  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    console.error(
      "\nChannel reported failure. If the HTTP block above shows a 4xx/5xx from the push service, that is likely a sently WebPushTransport / crypto issue — report it upstream with the raw status, headers, and body. Do not patch sently from this repo.",
    );
    process.exit(1);
  }

  console.log(
    "\nIf encryption + VAPID are correct, the OS should show a notification titled “okengine webpush interop”.",
  );
}

await main();
