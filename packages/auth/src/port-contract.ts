// The one contract suite both `AuthPort` implementations must satisfy (SP2 claim-check
// list). Run against the in-memory fake and against the real Supabase adapter, it is the
// cohesion proof: the two assemblies (in-process key generation vs. background-refreshed
// fetch) agree on every claim check at the port boundary. Rotation, debounced refresh,
// and the zero-network property are implementation specifics tested in supabase.test.ts.
//
// There is no numbered invariant for the auth port; per SP2 these tests cite the
// identity ACL in DESIGN.md §8, tagged "auth port (DESIGN §8)" so coverage is greppable.

import { beforeEach, describe, expect, it } from "vitest";
import type { AuthPort } from "./port";
import type { MintOptions } from "./fake";

/**
 * What a contract run needs: a port to verify against and a minter that signs tokens the
 * port trusts. Both harnesses use the same fake provider as minter; they differ only in
 * which port verifies (the fake itself, or an adapter pointed at the fake's JWKS).
 */
export interface AuthPortContractHarness {
  readonly label: string;
  readonly port: AuthPort;
  readonly issuer: string;
  readonly audience: string;
  readonly clockToleranceSec: number;
  mint(opts?: MintOptions): Promise<string>;
  mintUnknownKid(opts?: MintOptions): Promise<string>;
  mintBadSignature(opts?: MintOptions): Promise<string>;
  mintHs256(opts?: MintOptions): Promise<string>;
}

export function runAuthPortContract(
  makeHarness: () => Promise<AuthPortContractHarness>,
): void {
  let h: AuthPortContractHarness;
  beforeEach(async () => {
    h = await makeHarness();
  });

  describe("auth port (DESIGN §8) claim-check contract", () => {
    it("verifies a valid token and maps sub -> userId (SP2 claims)", async () => {
      const token = await h.mint({
        sub: "11111111-1111-4111-8111-111111111111",
      });
      const result = await h.port.verify(token);
      expect(result).toEqual({
        ok: true,
        identity: {
          userId: "11111111-1111-4111-8111-111111111111",
          isAnonymous: false,
          displayName: null,
        },
      });
    });

    it("lifts a display name from the user-metadata claim (auth port DESIGN §8)", async () => {
      // Both port assemblies must extract the name the API mirrors into users.display_name.
      const result = await h.port.verify(
        await h.mint({ userMetadata: { full_name: "Ana" } }),
      );
      expect(result).toEqual({
        ok: true,
        identity: expect.objectContaining({ displayName: "Ana" }),
      });
    });

    it("resolves displayName to null when the token carries no metadata (auth port DESIGN §8)", async () => {
      const result = await h.port.verify(await h.mint());
      expect(result).toEqual({
        ok: true,
        identity: expect.objectContaining({ displayName: null }),
      });
    });

    it("passes is_anonymous: true through unchanged (SP2, SP1)", async () => {
      const result = await h.port.verify(await h.mint({ isAnonymous: true }));
      expect(result).toEqual({
        ok: true,
        identity: expect.objectContaining({ isAnonymous: true }),
      });
    });

    it("passes is_anonymous: false through unchanged (SP2)", async () => {
      const result = await h.port.verify(await h.mint({ isAnonymous: false }));
      expect(result).toEqual({
        ok: true,
        identity: expect.objectContaining({ isAnonymous: false }),
      });
    });

    it("defaults isAnonymous to false when the claim is absent (SP2)", async () => {
      const result = await h.port.verify(
        await h.mint({ omitAnonymousClaim: true }),
      );
      expect(result).toEqual({
        ok: true,
        identity: expect.objectContaining({ isAnonymous: false }),
      });
    });

    it("rejects an expired token beyond the skew window (SP2)", async () => {
      const result = await h.port.verify(
        await h.mint({ expSecondsFromNow: -3600 }),
      );
      expect(result).toEqual({ ok: false, reason: "expired" });
    });

    it("accepts a token expired within the clock-skew tolerance (SP2 skew boundary)", async () => {
      const withinSkew = -(h.clockToleranceSec - 1);
      const result = await h.port.verify(
        await h.mint({ expSecondsFromNow: withinSkew }),
      );
      expect(result.ok).toBe(true);
    });

    it("rejects a token expired exactly at the skew edge (SP2: boundary is exclusive)", async () => {
      // jose's check is `exp <= now - tolerance` -> expired, so the last accepted
      // instant is one second inside the window, not on the edge.
      const result = await h.port.verify(
        await h.mint({ expSecondsFromNow: -h.clockToleranceSec }),
      );
      expect(result).toEqual({ ok: false, reason: "expired" });
    });

    it("rejects a token expired just past the skew boundary (SP2)", async () => {
      const result = await h.port.verify(
        await h.mint({ expSecondsFromNow: -(h.clockToleranceSec + 1) }),
      );
      expect(result).toEqual({ ok: false, reason: "expired" });
    });

    it("rejects a mismatched issuer (SP2 exact iss)", async () => {
      const result = await h.port.verify(
        await h.mint({ issuer: "https://evil.example/auth/v1" }),
      );
      expect(result).toEqual({ ok: false, reason: "wrong-issuer" });
    });

    it("rejects a mismatched audience (SP2 aud === authenticated)", async () => {
      const result = await h.port.verify(await h.mint({ audience: "anon" }));
      expect(result).toEqual({ ok: false, reason: "wrong-audience" });
    });

    it("rejects a tampered/foreign signature (SP2)", async () => {
      const result = await h.port.verify(await h.mintBadSignature());
      expect(result).toEqual({ ok: false, reason: "bad-signature" });
    });

    it("refuses an HS256 token, closing alg-confusion (SP2 asymmetric-only allowlist)", async () => {
      const result = await h.port.verify(await h.mintHs256());
      expect(result).toEqual({ ok: false, reason: "bad-signature" });
    });

    it("fails closed on an unknown kid (SP2)", async () => {
      const result = await h.port.verify(await h.mintUnknownKid());
      expect(result).toEqual({ ok: false, reason: "unknown-key" });
    });

    it("rejects a structurally malformed token (SP2)", async () => {
      for (const junk of ["", "garbage", "a.b", "a.b.c"]) {
        const result = await h.port.verify(junk);
        expect(result).toEqual({ ok: false, reason: "malformed" });
      }
    });
  });
}
