import { describe, expect, it } from "vitest";
import { base64UrlEncode, generateVerifier, s256Challenge } from "./pkce";

// RFC 7636 appendix B: the reference octet sequence, its verifier, its challenge.
const RFC7636_OCTETS = new Uint8Array([
  116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186,
  22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121,
]);
const RFC7636_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC7636_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

describe("base64UrlEncode", () => {
  it("uses the url-safe alphabet and no padding", () => {
    expect(base64UrlEncode(new Uint8Array([251, 255]))).toBe("-_8");
    expect(base64UrlEncode(new Uint8Array([0]))).toBe("AA");
    expect(base64UrlEncode(new Uint8Array([]))).toBe("");
  });
});

describe("generateVerifier", () => {
  it("encodes the RFC 7636 appendix B octets to the reference verifier", () => {
    expect(generateVerifier(RFC7636_OCTETS)).toBe(RFC7636_VERIFIER);
  });

  it("emits 43 characters of the unreserved charset for 32 octets", () => {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) bytes[i] = i * 7;
    const verifier = generateVerifier(bytes);
    expect(verifier).toHaveLength(43);
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]+$/);
  });
});

describe("s256Challenge", () => {
  it("matches the RFC 7636 appendix B S256 vector", async () => {
    expect(await s256Challenge(RFC7636_VERIFIER)).toBe(RFC7636_CHALLENGE);
  });
});
