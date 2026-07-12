import { describe, expect, it } from "vitest";
import { buildEnvelope } from "./envelope";
import { syntheticCrossword } from "./guardian/fixtures";
import { SYNTHETIC_RAWC } from "./amuselabs/fixtures";

describe("buildEnvelope", () => {
  it("carries exactly {format, document}, the PROTOCOL section 12 envelope", () => {
    const envelope = buildEnvelope("guardian", syntheticCrossword);
    expect(Object.keys(envelope)).toEqual(["format", "document"]);
    expect(envelope.format).toBe("guardian");
  });

  it("passes an object document through by reference, untransformed (D21: extraction-only)", () => {
    const envelope = buildEnvelope("nyt", syntheticCrossword);
    expect(envelope.format).toBe("nyt");
    expect(envelope.document).toBe(syntheticCrossword);
    expect(JSON.stringify(envelope)).toBe(
      `{"format":"nyt","document":${JSON.stringify(syntheticCrossword)}}`,
    );
  });

  it("passes a string document through verbatim (amuselabs blob stays encoded, D21)", () => {
    const envelope = buildEnvelope("amuselabs", SYNTHETIC_RAWC);
    expect(envelope.document).toBe(SYNTHETIC_RAWC);
    expect(JSON.stringify(envelope)).toBe(
      `{"format":"amuselabs","document":${JSON.stringify(SYNTHETIC_RAWC)}}`,
    );
  });
});
