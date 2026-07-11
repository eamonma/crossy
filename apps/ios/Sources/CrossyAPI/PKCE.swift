// PKCE (RFC 7636) for the Discord-through-Supabase sign-in (roadmap I3a). The
// derivation is pure over injected bytes so the RFC's appendix B vector pins it
// headlessly; only the default verifier reaches for the system RNG. S256 only:
// the plain method exists in the RFC for clients that cannot hash, which we are not.

import CryptoKit
import Foundation

public enum PKCE {
    /// A code verifier from the given entropy: base64url without padding, so every
    /// character is in the RFC 7636 unreserved set. 32 bytes encode to 43 characters,
    /// the RFC's minimum length and the conventional choice.
    public static func verifier(bytes: [UInt8]) -> String {
        base64URL(Data(bytes))
    }

    /// A fresh random verifier (32 bytes from the system CSPRNG).
    public static func verifier() -> String {
        var generator = SystemRandomNumberGenerator()
        var bytes = [UInt8]()
        bytes.reserveCapacity(32)
        for _ in 0..<32 {
            bytes.append(UInt8.random(in: .min ... .max, using: &generator))
        }
        return verifier(bytes: bytes)
    }

    /// The S256 challenge: base64url(SHA-256(ASCII(verifier))), no padding
    /// (RFC 7636 §4.2). Verifiers are base64url output, ASCII by construction.
    public static func challenge(for verifier: String) -> String {
        base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    /// base64url without padding (RFC 4648 §5), the encoding both PKCE values use.
    static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
