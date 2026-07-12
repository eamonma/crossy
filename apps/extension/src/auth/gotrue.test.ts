import { describe, expect, it } from "vitest";
import type { AuthTarget } from "./gotrue";
import { exchangeCode, revokeSession } from "./gotrue";

const TARGET: AuthTarget = {
  authBaseUrl: "https://api.crossy.party",
  publishableKey: "sb_publishable_test",
};

function capture(status = 200, body: unknown = {}) {
  const seen: { url?: string; init?: RequestInit | undefined } = {};
  const fetchFn: typeof fetch = (url, init) => {
    seen.url = String(url);
    seen.init = init;
    // 204 must carry no body per the fetch spec.
    const payload = status === 204 ? null : JSON.stringify(body);
    return Promise.resolve(new Response(payload, { status }));
  };
  return { seen, fetchFn };
}

describe("exchangeCode", () => {
  it("posts auth_code and code_verifier to the pkce grant with the apikey", async () => {
    const { seen, fetchFn } = capture(200, { access_token: "at" });
    const result = await exchangeCode(TARGET, "code-1", "verifier-1", fetchFn);
    expect(result.ok).toBe(true);
    expect(seen.url).toBe(
      "https://api.crossy.party/auth/v1/token?grant_type=pkce",
    );
    const headers = seen.init?.headers as Record<string, string>;
    expect(headers["apikey"]).toBe("sb_publishable_test");
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(String(seen.init?.body))).toEqual({
      auth_code: "code-1",
      code_verifier: "verifier-1",
    });
  });

  it("reports the HTTP status on failure and null on a network throw", async () => {
    const { fetchFn } = capture(403, { error: "nope" });
    expect(await exchangeCode(TARGET, "c", "v", fetchFn)).toEqual({
      ok: false,
      status: 403,
    });
    const down: typeof fetch = () => Promise.reject(new TypeError("down"));
    expect(await exchangeCode(TARGET, "c", "v", down)).toEqual({
      ok: false,
      status: null,
    });
  });
});

describe("revokeSession", () => {
  it("posts the bearer to logout with scope=local and swallows failures", async () => {
    const { seen, fetchFn } = capture(204, null);
    await revokeSession(TARGET, "at-1", fetchFn);
    expect(seen.url).toBe(
      "https://api.crossy.party/auth/v1/logout?scope=local",
    );
    const headers = seen.init?.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer at-1");
    // Best-effort: a dead network must not throw out of sign-out.
    const down: typeof fetch = () => Promise.reject(new TypeError("down"));
    await expect(revokeSession(TARGET, "at-1", down)).resolves.toBeUndefined();
  });
});
