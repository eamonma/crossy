import { describe, expect, it } from "vitest";
import { buildGuardianEnvelope } from "./envelope";
import { syntheticCrossword } from "./guardian/fixtures";

describe("buildGuardianEnvelope", () => {
  it("carries exactly {format, document}, the PROTOCOL section 12 envelope", () => {
    const envelope = buildGuardianEnvelope(syntheticCrossword);
    expect(Object.keys(envelope)).toEqual(["format", "document"]);
    expect(envelope.format).toBe("guardian");
  });

  it("passes the document through by reference, untransformed (D21: extraction-only)", () => {
    const envelope = buildGuardianEnvelope(syntheticCrossword);
    expect(envelope.document).toBe(syntheticCrossword);
    expect(JSON.stringify(envelope)).toBe(
      `{"format":"guardian","document":${JSON.stringify(syntheticCrossword)}}`,
    );
  });
});
