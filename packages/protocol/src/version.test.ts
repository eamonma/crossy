import { expect, it } from "vitest";
import { PROTOCOL_VERSION } from "./index";

it("PROTOCOL_VERSION is 1, matching PROTOCOL.md v1 (§2, §14 changelog)", () => {
  expect(PROTOCOL_VERSION).toBe(1);
});
