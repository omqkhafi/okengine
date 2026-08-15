/**
 * Format a Call API invoke result for the Response panel.
 */

import type { FlowsInvokeResult } from "@/client.ts";
import { maskPiiValue } from "../../../../../../console/server/runs-pii.ts";

/**
 * JSON shown under Response. Success paints the handler output; failures
 * keep the envelope so status / failure stay visible.
 *
 * @param data - Invoke mutation result
 */
export function formatInvokeResponseJson(data: FlowsInvokeResult): string {
  if (data.failure != null) {
    return JSON.stringify(
      {
        status: data.status ?? null,
        failure: data.failure,
        response: data.response ?? null,
      },
      null,
      2,
    );
  }
  if (data.response !== undefined && data.response !== null) {
    return JSON.stringify(data.response, null, 2);
  }
  return JSON.stringify(
    {
      status: data.status ?? 200,
      failure: null,
      response: null,
    },
    null,
    2,
  );
}

/**
 * Format the Response JSON, remasking classified keys when Include PII is off.
 *
 * Remask is synchronous so cleartext never paints for a frame when the
 * last invoke returned `masked: false`.
 *
 * @param data - Invoke mutation result
 * @param piiMasked - True when the PII toggle is off
 * @param piiFields - Classified field names from the Manifest
 */
export function formatCallApiResponseJson(
  data: FlowsInvokeResult,
  piiMasked: boolean,
  piiFields: ReadonlySet<string>,
): string {
  if (piiMasked && data.masked === false) {
    return formatInvokeResponseJson({
      ...data,
      response: maskPiiValue(data.response, piiFields),
      failure:
        data.failure === undefined
          ? undefined
          : {
              ...data.failure,
              data: maskPiiValue(data.failure.data, piiFields),
            },
      masked: true,
    });
  }
  return formatInvokeResponseJson(data);
}
