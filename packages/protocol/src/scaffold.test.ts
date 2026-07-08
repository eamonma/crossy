import { expect, it } from "vitest";
import { PROTOCOL_VERSION } from "./index";

it("PROTOCOL_VERSION matches PROTOCOL.md v1", () => {
  expect(PROTOCOL_VERSION).toBe(1);
});
