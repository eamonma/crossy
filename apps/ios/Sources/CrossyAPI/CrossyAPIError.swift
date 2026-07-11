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

    /// The server broke the contract's frame: a non-HTTP response (`status` nil) or a
    /// non-2xx body that is not the section 12 envelope (a proxy error page, say).
    case invalidResponse(status: Int?)

    /// A 2xx body that did not decode as the documented payload. The call succeeded on
    /// the wire; the payload contract is what broke.
    case decodingFailed(status: Int, underlying: any Error)
}

extension CrossyAPIError {
    /// The typed section 12 code for `.api` failures, nil otherwise or when the code is
    /// outside the vocabulary this client knows.
    public var apiCode: APIErrorCode? {
        guard case .api(_, let envelope) = self else { return nil }
        return envelope.code
    }

    /// The stable code string for `.api` failures (present even for a code this client
    /// does not know), nil for every other case.
    public var apiCodeString: String? {
        guard case .api(_, let envelope) = self else { return nil }
        return envelope.error
    }
}
