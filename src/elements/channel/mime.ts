/**
 * MIME building, attachments, retry, and error hierarchy — adopted from sently.
 *
 * Transport interface is identical so sently transports (`SMTPTransport`,
 * `ResendTransport`, …) run unchanged. MIME generation lives inside those
 * transports; OKE does not re-implement it.
 */

export type { Attachment, MailOptions, SendResult, Transport, RetryConfig } from "sently";

export { SentlyError } from "sently/errors";
export { RetryTransport } from "sently/transports/retry";
export { FallbackTransport, FallbackError, type FallbackAttempt } from "sently/transports/fallback";
