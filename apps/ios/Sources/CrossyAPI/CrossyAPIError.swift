// The client-side failure taxonomy for the REST companion (PROTOCOL.md section 12).
// Every REST failure the server sends is `{ error, message }` plus an HTTP status, keyed
// on the stable code string, never on prose; this enum keeps that split visible to
// callers: `.api` is the server speaking the contract (network fine, request refused),
// `.transport` is network weather (nothing was answered), and the remaining cases name
// the ways a request can fail before or outside the contract.

import CrossyProtocol
import Foundation

/// Every way a `CrossyAPIClient` call fails. Callers switch on the case to tell network
/// weather from API rejection, and key `.api` on `envelope.code` (typed) or
/// `envelope.error` (the stable string), never on `envelope.message` prose.
public enum CrossyAPIError: Error {
    /// The token provider could not produce a bearer token; no request was sent.
    case tokenUnavailable(underlying: any Error)

    /// The request never produced an HTTP response: offline, DNS, TLS, timeout,
    /// cancellation. Retrying can help; nothing about the request was judged.
    case transport(underlying: any Error)

    /// The server answered non-2xx with the section 12 envelope. `envelope.error` is the
    /// stable code string, always present; `envelope.code` is the typed view, nil for a
    /// code this client does not know yet (section 12 names codeless rejections that may
    /// gain codes later, so an unknown code degrades, it never fails the decode).
    case api(status: Int, envelope: APIErrorEnvelope)

    /// A `429 RATE_LIMITED`: the caller spent a write window (PATCH /me is rate-limited
    /// per user, docs/design/name-onboarding.md §7.2). Carried as its own case because
    /// the `Retry-After` header the UI honors (R4/R9) is not in the envelope body;
    /// `retryAfter` is the parsed delay in seconds, nil when the header was absent or
    /// unparseable. Still an `.api`-shaped rejection (network fine, request refused), so
    /// digest sites that only care about the code read `envelope.error` here too.
    case rateLimited(retryAfter: TimeInterval?, envelope: APIErrorEnvelope)

    /// The server broke the contract's frame: a non-HTTP response (`status` nil) or a
    /// non-2xx body that is not the section 12 envelope (a proxy error page, say).
    case invalidResponse(status: Int?)

    /// A 2xx body that did not decode as the documented payload. The call succeeded on
    /// the wire; the payload contract is what broke.
    case decodingFailed(status: Int, underlying: any Error)
}

extension CrossyAPIError {
    /// The typed section 12 code for `.api`/`.rateLimited` failures, nil otherwise or when
    /// the code is outside the vocabulary this client knows.
    public var apiCode: APIErrorCode? {
        switch self {
        case .api(_, let envelope), .rateLimited(_, let envelope):
            return envelope.code
        default:
            return nil
        }
    }

    /// The stable code string for `.api`/`.rateLimited` failures (present even for a code
    /// this client does not know), nil for every other case.
    public var apiCodeString: String? {
        switch self {
        case .api(_, let envelope), .rateLimited(_, let envelope):
            return envelope.error
        default:
            return nil
        }
    }

    /// The `Retry-After` delay (seconds) for a `.rateLimited` failure, nil when the
    /// header was absent or the failure is a different kind. The onboarding submit honors
    /// this before its next auto-retry (R4).
    public var retryAfterSeconds: TimeInterval? {
        guard case .rateLimited(let retryAfter, _) = self else { return nil }
        return retryAfter
    }
}
