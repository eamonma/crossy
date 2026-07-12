import { describe, expect, it } from "vitest";
import { buildAuthorizeUrl, extractCode } from "./flow";

const REDIRECT = "https://abcdefghijklmnop.chromiumapp.org/";

describe("buildAuthorizeUrl", () => {
  it("targets /auth/v1/authorize with provider, redirect_to, and the S256 challenge", () => {
    const url = new URL(
      buildAuthorizeUrl(
        "https://api.crossy.party",
        "discord",
        REDIRECT,
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      ),
    );
    expect(url.origin).toBe("https://api.crossy.party");
    expect(url.pathname).toBe("/auth/v1/authorize");
    expect(url.searchParams.get("provider")).toBe("discord");
    expect(url.searchParams.get("redirect_to")).toBe(REDIRECT);
    expect(url.searchParams.get("code_challenge")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
    // Lowercase to match supabase-js byte for byte.
    expect(url.searchParams.get("code_challenge_method")).toBe("s256");
  });

  it("carries the apple provider through unchanged", () => {
    const url = new URL(
      buildAuthorizeUrl("https://api.crossy.party", "apple", REDIRECT, "c"),
    );
    expect(url.searchParams.get("provider")).toBe("apple");
  });
});

describe("extractCode", () => {
  it("pulls ?code= out of the captured redirect", () => {
    const out = extractCode(`${REDIRECT}?code=a1b2c3`);
    expect(out).toEqual({ ok: true, code: "a1b2c3" });
  });

  it("surfaces error_description verbatim from the query", () => {
    const out = extractCode(
      `${REDIRECT}?error=access_denied&error_description=User+refused`,
    );
    expect(out).toEqual({ ok: false, reason: "User refused" });
  });

  it("surfaces errors carried in the fragment", () => {
    const out = extractCode(
      `${REDIRECT}#error=server_error&error_description=Provider+down`,
    );
    expect(out).toEqual({ ok: false, reason: "Provider down" });
  });

  it("falls back to the bare error code, then to a fixed reason", () => {
    expect(extractCode(`${REDIRECT}?error=access_denied`)).toEqual({
      ok: false,
      reason: "access_denied",
    });
    expect(extractCode(REDIRECT)).toEqual({
      ok: false,
      reason: "sign-in returned no code",
    });
  });

  it("rejects an unparseable redirect", () => {
    expect(extractCode("not a url").ok).toBe(false);
  });
});
