// The in-memory fake as implementation #1 of the shared contract, plus the mint helpers
// and rotation behavior the fake adds on top. Tests cite the identity ACL (DESIGN.md §8)
// and the spikes (SP1 upgrade lag, SP2 claims). No network, no Docker.

import { describe, expect, it } from "vitest";
import { createFakeAuthProvider } from "./fake";
import {
  runAuthPortContract,
  type AuthPortContractHarness,
} from "./port-contract";

const FIXED_NOW = new Date("2026-07-08T00:00:00.000Z");
const ISSUER = "https://fake-auth.crossy.test/auth/v1";
const AUDIENCE = "authenticated";
const SKEW = 10;

async function makeFakeHarness(): Promise<AuthPortContractHarness> {
  const idp = await createFakeAuthProvider({
    issuer: ISSUER,
    audience: AUDIENCE,
    clockToleranceSec: SKEW,
    now: () => FIXED_NOW,
  });
  return {
    label: "fake",
    port: idp,
    issuer: ISSUER,
    audience: AUDIENCE,
    clockToleranceSec: SKEW,
    mint: idp.mint,
    mintUnknownKid: idp.mintUnknownKid,
    mintBadSignature: idp.mintBadSignature,
    mintHs256: idp.mintHs256,
  };
}

runAuthPortContract(makeFakeHarness);

describe("fake provider helpers (DESIGN §8, SP1/SP2)", () => {
  it("mintAnonymous / mintUpgraded set is_anonymous (SP2)", async () => {
    const idp = await createFakeAuthProvider({ now: () => FIXED_NOW });
    const anon = await idp.verify(await idp.mintAnonymous({ sub: "guest-1" }));
    expect(anon).toEqual({
      ok: true,
      identity: { userId: "guest-1", isAnonymous: true, displayName: null },
    });
    const permanent = await idp.verify(
      await idp.mintUpgraded({ sub: "guest-1" }),
    );
    expect(permanent).toEqual({
      ok: true,
      identity: { userId: "guest-1", isAnonymous: false, displayName: null },
    });
  });

  it("mints a user-metadata name that verify lifts into displayName (DESIGN §8)", async () => {
    const idp = await createFakeAuthProvider({ now: () => FIXED_NOW });
    const result = await idp.verify(
      await idp.mint({ sub: "named-1", userMetadata: { full_name: "Ada" } }),
    );
    expect(result).toEqual({
      ok: true,
      identity: { userId: "named-1", isAnonymous: false, displayName: "Ada" },
    });
  });

  it("mintUnrefreshedUpgrade keeps the same sub but still reports anonymous (SP1 lag)", async () => {
    // SP1: a just-upgraded guest carries is_anonymous: true for up to one token
    // lifetime. verify reports the token faithfully; the API's JIT upsert tolerates it.
    const idp = await createFakeAuthProvider({ now: () => FIXED_NOW });
    const result = await idp.verify(
      await idp.mintUnrefreshedUpgrade({ sub: "keeps-id" }),
    );
    expect(result).toEqual({
      ok: true,
      identity: { userId: "keeps-id", isAnonymous: true, displayName: null },
    });
  });

  it("mintExpired is rejected as expired (SP2)", async () => {
    const idp = await createFakeAuthProvider({ now: () => FIXED_NOW });
    expect(await idp.verify(await idp.mintExpired())).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("publishes an ES256 JWKS and a derived jwksUri (SP2)", async () => {
    const idp = await createFakeAuthProvider({ issuer: ISSUER });
    const set = idp.jwks();
    expect(set.keys).toHaveLength(1);
    expect(set.keys[0]).toMatchObject({
      alg: "ES256",
      kty: "EC",
      use: "sig",
      kid: idp.currentKid(),
    });
    expect(idp.jwksUri()).toBe(
      "https://fake-auth.crossy.test/auth/v1/.well-known/jwks.json",
    );
  });

  it("rotate publishes both keys and keeps signing tokens verifiable (SP2 overlap)", async () => {
    const idp = await createFakeAuthProvider({ now: () => FIXED_NOW });
    const oldKid = idp.currentKid();
    const oldToken = await idp.mint({ sub: "u" });

    const newKid = await idp.rotate();
    expect(newKid).not.toBe(oldKid);
    expect(idp.jwks().keys).toHaveLength(2);

    const newToken = await idp.mint({ sub: "u" });
    // The provider verifies both the pre- and post-rotation token against one JWKS.
    expect((await idp.verify(oldToken)).ok).toBe(true);
    expect((await idp.verify(newToken)).ok).toBe(true);

    idp.revokeKey(oldKid);
    expect(await idp.verify(oldToken)).toEqual({
      ok: false,
      reason: "unknown-key",
    });
    expect((await idp.verify(newToken)).ok).toBe(true);
  });
});
