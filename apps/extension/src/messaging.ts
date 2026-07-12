// The popup-to-content-script message contract. One request, one reply.

import type { ExtractResult } from "./guardian/extract";

export const EXTRACT_REQUEST = "crossy/extract" as const;

export interface ExtractRequest {
  readonly type: typeof EXTRACT_REQUEST;
}

export type ExtractResponse = ExtractResult;
