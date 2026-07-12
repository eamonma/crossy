import { describe, expect, it } from "vitest";
import {
  ALARM_LEAD_SEC,
  classifyRefreshFailure,
  needsRefresh,
  refreshAlarmWhenMs,
  REFRESH_MARGIN_SEC,
  sessionFromTokenResponse,
} from "./session";

const NOW = 1_750_000_000;

function tokenResponse(overrides: Record<string, unknown> = {}): unknown {
  return {
    access_token: "at-1",
    refresh_token: "rt-1",
    expires_in: 3600,
    expires_at: NOW + 3600,
    token_type: "bearer",
    user: { email: "solver@example.com", user_metadata: { full_name: "Ada" } },
    ...overrides,
  };
}

describe("sessionFromTokenResponse", () => {
  it("maps the GoTrue token body to the stored session", () => {
    const session = sessionFromTokenResponse(tokenResponse(), NOW);
    expect(session).toEqual({
      accessToken: "at-1",
      refreshToken: "rt-1",
      expiresAt: NOW + 3600,
      email: "solver@example.com",
      displayName: "Ada",
    });
  });

  it("computes expiry from expires_in when expires_at is absent", () => {
    const session = sessionFromTokenResponse(
      tokenResponse({ expires_at: undefined }),
      NOW,
    );
    expect(session?.expiresAt).toBe(NOW + 3600);
  });

  it("rejects bodies missing either token or any expiry", () => {
    expect(sessionFromTokenResponse(null, NOW)).toBeNull();
    expect(
      sessionFromTokenResponse(tokenResponse({ access_token: "" }), NOW),
    ).toBeNull();
    expect(
      sessionFromTokenResponse(tokenResponse({ refresh_token: 7 }), NOW),
    ).toBeNull();
    expect(
      sessionFromTokenResponse(
        tokenResponse({ expires_at: undefined, expires_in: undefined }),
        NOW,
      ),
    ).toBeNull();
  });

  it("falls back to the email local part, but never for Apple private relays", () => {
    const plain = sessionFromTokenResponse(
      tokenResponse({ user: { email: "solver@example.com" } }),
      NOW,
    );
    expect(plain?.displayName).toBe("solver");
    const relay = sessionFromTokenResponse(
      tokenResponse({ user: { email: "x9q2@privaterelay.appleid.com" } }),
      NOW,
    );
    expect(relay?.displayName).toBe("Player");
  });
});

describe("needsRefresh", () => {
  it("is false outside the margin, true at and inside it", () => {
    expect(needsRefresh(NOW + REFRESH_MARGIN_SEC + 1, NOW)).toBe(false);
    expect(needsRefresh(NOW + REFRESH_MARGIN_SEC, NOW)).toBe(true);
    expect(needsRefresh(NOW + 1, NOW)).toBe(true);
    expect(needsRefresh(NOW - 10, NOW)).toBe(true);
  });
});

describe("refreshAlarmWhenMs", () => {
  it("schedules the lead interval before expiry", () => {
    const expiresAt = NOW + 3600;
    expect(refreshAlarmWhenMs(expiresAt, NOW)).toBe(
      (expiresAt - ALARM_LEAD_SEC) * 1000,
    );
  });

  it("floors near-expiry tokens to a near-term alarm, never one in the past", () => {
    expect(refreshAlarmWhenMs(NOW + 10, NOW)).toBe((NOW + 30) * 1000);
    expect(refreshAlarmWhenMs(NOW - 100, NOW)).toBe((NOW + 30) * 1000);
  });
});

describe("classifyRefreshFailure", () => {
  it("treats 400/401/403 as the definitive signed-out verdict", () => {
    expect(classifyRefreshFailure(400)).toBe("signed_out");
    expect(classifyRefreshFailure(401)).toBe("signed_out");
    expect(classifyRefreshFailure(403)).toBe("signed_out");
  });

  it("retries everything else: network, rate limits, server errors, bad paths", () => {
    expect(classifyRefreshFailure(null)).toBe("retry");
    expect(classifyRefreshFailure(404)).toBe("retry");
    expect(classifyRefreshFailure(429)).toBe("retry");
    expect(classifyRefreshFailure(500)).toBe("retry");
    expect(classifyRefreshFailure(503)).toBe("retry");
  });
});
