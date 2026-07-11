// The Supabase admin adapter (DESIGN.md §8): its `VendorIdentityPort.deleteUser` calls the
// Admin API with an injected fetch, so this suite records the request and drives each status
// without a socket (repo law: no test touches the network).
import { describe, expect, it } from "vitest";
import { createSupabaseAdminIdentity } from "./supabase-admin";

const URL_BASE = "https://proj.supabase.co";
const KEY = "service-role-secret";

/** A recording fetch that returns the given status, capturing the one request it receives. */
function recordingFetch(status: number): {
  fetchImpl: typeof fetch;
  calls: { url: string; init: RequestInit | undefined }[];
} {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl = ((input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Promise.resolve(new Response(null, { status }));
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("supabase admin adapter deleteUser (DESIGN.md §8)", () => {
  it("DELETEs the admin users endpoint with the service_role bearer and apikey", async () => {
    const { fetchImpl, calls } = recordingFetch(200);
    const port = createSupabaseAdminIdentity({
      url: URL_BASE,
      serviceRoleKey: KEY,
      fetchImpl,
    });

    await port.deleteUser("user-123");

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe(`${URL_BASE}/auth/v1/admin/users/user-123`);
    expect(call?.init?.method).toBe("DELETE");
    const headers = call?.init?.headers as Record<string, string>;
    expect(headers["authorization"]).toBe(`Bearer ${KEY}`);
    expect(headers["apikey"]).toBe(KEY);
  });

  it("trims a trailing slash on the base url and encodes the user id", async () => {
    const { fetchImpl, calls } = recordingFetch(204);
    const port = createSupabaseAdminIdentity({
      url: `${URL_BASE}/`,
      serviceRoleKey: KEY,
      fetchImpl,
    });

    await port.deleteUser("weird/id?x");

    expect(calls[0]?.url).toBe(
      `${URL_BASE}/auth/v1/admin/users/weird%2Fid%3Fx`,
    );
  });

  it("resolves on a 2xx (identity removed)", async () => {
    const { fetchImpl } = recordingFetch(200);
    const port = createSupabaseAdminIdentity({
      url: URL_BASE,
      serviceRoleKey: KEY,
      fetchImpl,
    });
    await expect(port.deleteUser("user-123")).resolves.toBeUndefined();
  });

  it("treats a 404 as success so deletion is idempotent (identity already gone)", async () => {
    const { fetchImpl } = recordingFetch(404);
    const port = createSupabaseAdminIdentity({
      url: URL_BASE,
      serviceRoleKey: KEY,
      fetchImpl,
    });
    await expect(port.deleteUser("user-123")).resolves.toBeUndefined();
  });

  it("throws on any other non-2xx so the route surfaces INTERNAL (deletion.ts contract)", async () => {
    for (const status of [401, 403, 429, 500, 503]) {
      const { fetchImpl } = recordingFetch(status);
      const port = createSupabaseAdminIdentity({
        url: URL_BASE,
        serviceRoleKey: KEY,
        fetchImpl,
      });
      await expect(port.deleteUser("user-123")).rejects.toThrow(
        `HTTP ${status}`,
      );
    }
  });
});
