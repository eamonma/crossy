// INV-11 (DESIGN.md): sign-in surfaces render only on a true sign-out, never on a transient token,
// HTTP, or transport failure. The live loader's gate decision is this pure predicate; LiveApp wires
// it to identity.getSession() and the `?token=` override. Node env, no renderer.
import { describe, expect, it } from "vitest";
import { isSignedOut } from "./authGate";

describe("live loader sign-in gate (INV-11)", () => {
  it("gates only on a true sign-out: no ?token= override and a null session (INV-11)", () => {
    expect(isSignedOut(null, false)).toBe(true);
  });

  it("a standing session never gates, even when a request 401s past the seam (INV-11)", () => {
    expect(isSignedOut(null, true)).toBe(false);
  });

  it("the ?token= override never gates: the smoke and dogfood ride a fixed token (INV-11)", () => {
    expect(isSignedOut("fixed-token", false)).toBe(false);
    expect(isSignedOut("fixed-token", true)).toBe(false);
  });
});
