import Foundation
import XCTest

import CrossyAPI

// PKCE derivation (RFC 7636), pinned by the RFC's own appendix B vector so the
// implementation cannot drift: the pair Supabase sees is the pair the RFC specifies.

final class PKCETests: XCTestCase {
    // RFC 7636 appendix B: the worked example's verifier and its S256 challenge.
    private let rfcVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    private let rfcChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"

    func test_theS256ChallengeMatchesTheRFC7636AppendixBVector() {
        XCTAssertEqual(PKCE.challenge(for: rfcVerifier), rfcChallenge)
    }

    func test_theVerifierFromKnownBytesIsBase64URLWithoutPadding() {
        // The RFC's appendix B octet sequence encodes to its verifier exactly.
        let octets: [UInt8] = [
            116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173,
            187, 186, 22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83,
            132, 141, 121,
        ]
        XCTAssertEqual(PKCE.verifier(bytes: octets), rfcVerifier)
    }

    func test_freshVerifiersAreRFCLengthUnreservedAndUnique() {
        // 32 random bytes encode to 43 characters, the RFC minimum; base64url output
        // stays inside the unreserved set (no +, /, or = ever).
        let unreserved = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
        var seen = Set<String>()
        for _ in 0..<32 {
            let verifier = PKCE.verifier()
            XCTAssertEqual(verifier.count, 43)
            XCTAssertTrue(verifier.allSatisfy(unreserved.contains))
            seen.insert(verifier)
        }
        XCTAssertEqual(seen.count, 32, "verifiers are entropy, never repeated")
    }
}
