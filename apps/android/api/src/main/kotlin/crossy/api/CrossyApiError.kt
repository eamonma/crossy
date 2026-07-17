// The client-side failure taxonomy for the REST companion (PROTOCOL.md §12). Twin of
// apps/ios CrossyAPIError.swift. Every REST failure the server sends is `{ error, message }`
// plus an HTTP status, keyed on the stable code string, never on prose; this hierarchy keeps
// that split visible to callers: `Api` is the server speaking the contract (network fine,
// request refused), `Transport` is network weather (nothing was answered), and the rest name
// the ways a request can fail before or outside the contract.

package crossy.api

import crossy.protocol.APIErrorCode
import crossy.protocol.APIErrorEnvelope

/**
 * Every way a [CrossyApiClient] call fails. Callers `when` on the subtype to tell network
 * weather from API rejection, and key [Api] on `envelope.code` (typed) or `envelope.error`
 * (the stable string), never on `envelope.message` prose.
 */
public sealed class CrossyApiError(message: String, cause: Throwable? = null) :
    Exception(message, cause) {

    /** The token provider could not produce a bearer token; no request was sent. */
    public class TokenUnavailable(cause: Throwable) :
        CrossyApiError("no bearer token available", cause)

    /** The request never produced an HTTP response: offline, DNS, TLS, timeout, cancellation.
     *  Retrying can help; nothing about the request was judged. */
    public class Transport(cause: Throwable) :
        CrossyApiError("transport failure", cause)

    /**
     * The server answered non-2xx with the §12 envelope. `envelope.error` is the stable code
     * string, always present; `envelope.code` is the typed view, null for a code this client
     * does not know yet (§12 names codeless rejections that may gain codes later, so an unknown
     * code degrades, it never fails the decode).
     */
    public class Api(public val status: Int, public val envelope: APIErrorEnvelope) :
        CrossyApiError("api rejected the request: ${envelope.error} ($status)")

    /**
     * A `429 RATE_LIMITED`: the caller spent a write window (PATCH /me is rate-limited per user,
     * docs/design/name-onboarding §7.2). Its own case because the `Retry-After` header the UI honors
     * (R4) is not in the envelope body; [retryAfterSeconds] is the parsed delay in seconds, null when
     * the header was absent or unparseable. Still an API rejection (network fine, request refused),
     * so callers that only need the code read [envelope] here too. Twin of iOS `.rateLimited`.
     */
    public class RateLimited(
        public val retryAfterSeconds: Double?,
        public val envelope: APIErrorEnvelope,
    ) : CrossyApiError("api rate limited: ${envelope.error} (429)")

    /** The server broke the contract's frame: a non-2xx body that is not the §12 envelope
     *  (a proxy error page, say). */
    public class InvalidResponse(public val status: Int?) :
        CrossyApiError("invalid response frame (status $status)")

    /** A 2xx body that did not decode as the documented payload. The call succeeded on the
     *  wire; the payload contract is what broke. */
    public class DecodingFailed(public val status: Int, cause: Throwable) :
        CrossyApiError("2xx body did not decode ($status)", cause)

    /** The typed §12 code for [Api]/[RateLimited] failures, null otherwise or when the code is
     *  outside the vocabulary this client knows. */
    public val apiCode: APIErrorCode?
        get() = when (this) {
            is Api -> envelope.code
            is RateLimited -> envelope.code
            else -> null
        }

    /** The stable code string for [Api]/[RateLimited] failures (present even for a code this client
     *  does not know), null for every other case. */
    public val apiCodeString: String?
        get() = when (this) {
            is Api -> envelope.error
            is RateLimited -> envelope.error
            else -> null
        }
}
