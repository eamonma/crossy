// Outbound error frames (PROTOCOL.md §11). Fatality is a property of the code, so it is
// read from the protocol's ERROR_CODES table rather than restated at each call site;
// only INTERNAL is "varies" and this slice never emits it. A fatal error is followed by
// a 1008 close by the caller (PROTOCOL.md §2, §11).

import { ERROR_CODES } from "@crossy/protocol";
import type { ErrorCode, ErrorMessage } from "@crossy/protocol";

/** Build an `error` frame, deriving `fatal` from the §11 table unless overridden. */
export function errorFrame(
  code: ErrorCode,
  message: string,
  options: { readonly commandId?: string; readonly fatal?: boolean } = {},
): ErrorMessage {
  const fatal = options.fatal ?? ERROR_CODES[code].fatal === true;
  const base: ErrorMessage = { type: "error", code, message, fatal };
  return options.commandId === undefined
    ? base
    : { ...base, commandId: options.commandId };
}
