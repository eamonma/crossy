// The Supabase auth REST leg (roadmap I3a): the authorize URL the web sheet opens,
// the PKCE code exchange, the refresh grant, and best-effort sign-out. Vendor calls
// only; the lifecycle lives in AuthSession and the phase walk in AuthStateMachine.
//
// The issuer trap (deploy/README.md, it has caused an outage once): every request
// here rides the CONFIGURED Supabase origin verbatim (the custom domain,
// CrossyConfig.plist SupabaseURL), while the tokens it returns carry the ref-domain
// `iss` that the deploy pins and the services verify against. This client therefore
// never reads, derives, or compares an issuer: tokens are opaque blobs to carry, and
// verification is the servers' job against SUPABASE_ISSUER. Deriving an issuer from
// the auth origin here would recreate the outage client-side.

import Foundation

/// The committed public auth facts (CrossyConfig.plist; every value is public by
/// design, INV-6 note in deploy/README.md). `nil` when the build carries no usable
/// values, which the Welcome screen surfaces as one plain sentence, never a crash.
public struct SupabaseAuthConfiguration: Sendable, Equatable {
    /// `{SupabaseURL}/auth/v1`, the GoTrue mount.
    public let authBaseURL: URL
    /// The `sb_publishable_...` key, sent as `apikey` on every auth call.
    public let publishableKey: String
    /// Where the OAuth leg lands back: a custom-scheme URL the web sheet intercepts
    /// (no Info.plist registration needed; ASWebAuthenticationSession owns the hop).
    public let redirectURL: URL

    public init?(supabaseURL: String?, publishableKey: String?, redirect: String) {
        guard
            let supabaseURL, !supabaseURL.isEmpty,
            let publishableKey, !publishableKey.isEmpty,
            let base = URL(string: supabaseURL), base.host != nil,
            let redirectURL = URL(string: redirect), redirectURL.scheme != nil
        else { return nil }
        self.authBaseURL =
            base
            .appendingPathComponent("auth")
            .appendingPathComponent("v1")
        self.publishableKey = publishableKey
        self.redirectURL = redirectURL
    }

    /// The scheme the web sheet waits for.
    public var callbackScheme: String {
        // Non-nil by the init guard.
        redirectURL.scheme ?? ""
    }
}

/// Which provider minted the session (display only; the token is the identity
/// authority, DESIGN.md §8). Remembered beside the session so the Account screen can
/// name the provider after a relaunch, never derived from the opaque token. Raw
/// values are the stable strings the Keychain marker stores.
public enum AuthProvider: String, Codable, Sendable, Equatable, CaseIterable {
    case discord
    case apple
    /// The custom OIDC provider (roadmap I3b). Its raw value is exactly the `provider=`
    /// query value GoTrue expects, so the same web-auth leg Discord rides serves it with
    /// no branching; the colon is URL-encoded where it lands in a query.
    case hisbaan = "custom:hisbaan"
    /// Email OTP / magic link (roadmap I3b). No web-auth leg: the session arrives through
    /// the two-step verify grant (or a magic-link verify), and this marker names it after
    /// a relaunch. Raw value is GoTrue's own `email` provider string.
    case emailOTP = "email"
}

/// One signed-in session as Supabase grants it and the Keychain stores it. Codable
/// because the Keychain blob is exactly this, JSON-encoded. `expiresAt` is unix
/// seconds; the token itself stays opaque (no JWT decode: the `exp` we need arrives
/// as a sibling field, and `iss` is deliberately never read, header note).
public struct SupabaseSession: Codable, Equatable, Sendable {
    public let accessToken: String
    public let refreshToken: String
    public let expiresAt: Double
    public let userId: String?

    public init(accessToken: String, refreshToken: String, expiresAt: Double, userId: String?) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiresAt = expiresAt
        self.userId = userId
    }
}

/// Why an auth call failed. `refused` is the auth server speaking (a dead refresh
/// token, a bad code); `transport` is network weather; the rest are broken frames.
public enum SupabaseAuthError: Error {
    case transport(underlying: any Error)
    /// The server answered 4xx: the grant is refused and retrying the same request
    /// cannot help. For a refresh this is the terminal case (the session is over).
    /// 408 and 429 are carved out: the limiter answered, not the grant evaluator,
    /// so they ride the transient lane below.
    case refused(status: Int)
    /// A 5xx or an undecodable body: the server faltered; the session stands and a
    /// later retry may succeed (the transient refresh case).
    case invalidResponse(status: Int?)
    /// The OAuth callback carried no code (or carried the provider's error).
    case invalidCallback
}

/// The vendor calls, a value over an injected URLSession (tests stub via
/// URLProtocol, the CrossyAPIClient pattern).
public struct SupabaseAuthClient: Sendable {
    public let configuration: SupabaseAuthConfiguration
    private let session: URLSession

    public init(configuration: SupabaseAuthConfiguration, session: URLSession = .shared) {
        self.configuration = configuration
        self.session = session
    }

    // MARK: - The authorize URL (the web sheet's destination)

    /// `GET {auth}/authorize?provider=<provider>&...`: where ASWebAuthenticationSession
    /// navigates. The provider is the raw value verbatim, with its reserved characters
    /// percent-encoded so `custom:hisbaan` rides as `custom%3Ahisbaan` (URLComponents leaves
    /// a bare colon in a query value, which some proxies mis-split; the encoded form is the
    /// contract). Only the provider value is re-encoded; every other item keeps the encoding
    /// URLComponents already gave it, so the Discord leg is byte-identical to before. Pure
    /// construction, pinned in tests against the configured origin verbatim (the issuer-trap
    /// posture: no origin rewriting anywhere). Defaults to Discord so the existing
    /// single-provider callers are unchanged.
    public func authorizeURL(
        provider: AuthProvider = .discord, codeChallenge: String
    ) -> URL {
        var components = URLComponents(
            url: configuration.authBaseURL.appendingPathComponent("authorize"),
            resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "provider", value: provider.rawValue),
            URLQueryItem(name: "redirect_to", value: configuration.redirectURL.absoluteString),
            URLQueryItem(name: "code_challenge", value: codeChallenge),
            URLQueryItem(name: "code_challenge_method", value: "s256"),
        ]
        // Force reserved characters out of the provider value only (chiefly the ":" in
        // `custom:hisbaan`), leaving the rest exactly as URLComponents encoded them. The
        // value still decodes back to the raw provider on the server's side.
        components.percentEncodedQueryItems = (components.percentEncodedQueryItems ?? []).map {
            item in
            guard item.name == "provider" else { return item }
            let encoded = provider.rawValue.addingPercentEncoding(
                withAllowedCharacters: Self.providerValueAllowed) ?? provider.rawValue
            return URLQueryItem(name: item.name, value: encoded)
        }
        return components.url!
    }

    /// The query-value character set minus the reserved characters we force-encode in the
    /// `provider` value (the ":" of `custom:hisbaan` above all).
    private static let providerValueAllowed: CharacterSet = {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: ":/?#[]@!$&'()*+,;=")
        return allowed
    }()

    /// The `code` out of the OAuth callback URL, or nil (a provider error lands as
    /// `error`/`error_description` query items and carries no code).
    public static func authorizationCode(fromCallback url: URL) -> String? {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let code = items.first { $0.name == "code" }?.value
        return (code?.isEmpty == false) ? code : nil
    }

    // MARK: - Token grants

    /// `POST {auth}/token?grant_type=pkce`: exchange the callback's code plus the
    /// held verifier for a session.
    public func exchangeCode(
        _ authCode: String, verifier: String, now: Date = Date()
    ) async throws -> SupabaseSession {
        try await grant(
            "pkce",
            body: ["auth_code": authCode, "code_verifier": verifier],
            now: now)
    }

    /// `POST {auth}/token?grant_type=refresh_token`: the silent refresh. A `refused`
    /// throw means the refresh token is dead (terminal); everything else is weather.
    public func refresh(refreshToken: String, now: Date = Date()) async throws -> SupabaseSession {
        try await grant("refresh_token", body: ["refresh_token": refreshToken], now: now)
    }

    /// `POST {auth}/token?grant_type=id_token`: trade an Apple identity token for a
    /// session (roadmap I3a, Sign in with Apple). GoTrue hashes the raw `nonce` we send
    /// and compares its hex against the id_token's nonce claim, so the value here is the
    /// RAW nonce, not the hashed challenge Apple stamped. Same grant plumbing and error
    /// taxonomy as the pkce leg (`refused` on 4xx, weather otherwise).
    public func exchangeAppleIDToken(
        _ idToken: String, nonce: String, now: Date = Date()
    ) async throws -> SupabaseSession {
        try await grant(
            "id_token",
            body: ["provider": "apple", "id_token": idToken, "nonce": nonce],
            now: now)
    }

    // MARK: - Email OTP / magic link (roadmap I3b)

    /// `POST {auth}/otp`: ask GoTrue to send the email code (and the magic link). No
    /// session comes back here, only a send acknowledgement, so the caller gets a bare
    /// throw-or-return over the same error taxonomy as the grants (`refused` on 4xx,
    /// weather otherwise). `create_user` mints an account on first sight, so a new email
    /// signs in rather than dead-ending.
    ///
    /// The optional `captchaToken` rides in `gotrue_meta_security.captcha_token`, the
    /// shape GoTrue reads: Supabase has Turnstile protection on project-wide, so a send
    /// without a token is refused with `captcha_failed`. iOS mints the token in a hidden
    /// Turnstile web view (the app target's TurnstileProvider) and passes it here. A nil
    /// token omits the block entirely, so a build with captcha off (or an older server)
    /// sends exactly as before.
    public func sendEmailOTP(email: String, captchaToken: String? = nil) async throws {
        _ = try await post(
            path: "otp",
            body: try? JSONEncoder().encode(
                SendOTPBody(email: email, createUser: true, captchaToken: captchaToken)))
    }

    /// `POST {auth}/verify`: exchange the emailed code for a session (the second step of
    /// the OTP flow). Same decode and error taxonomy as the token grants.
    public func verifyEmailOTP(
        email: String, token: String, now: Date = Date()
    ) async throws -> SupabaseSession {
        let data = try await post(
            path: "verify",
            body: try? JSONEncoder().encode(
                ["type": "email", "email": email, "token": token]))
        return try Self.session(from: data, now: now)
    }

    /// `POST {auth}/verify`: complete a magic link by its `token_hash`. `type` is the link's
    /// own type (`magiclink`, `email`, ...), passed through verbatim from the callback. Same
    /// decode and error taxonomy as the token grants. A later wave wires CrossyApp to route
    /// the universal link here.
    public func verifyEmailLink(
        tokenHash: String, type: String, now: Date = Date()
    ) async throws -> SupabaseSession {
        let data = try await post(
            path: "verify",
            body: try? JSONEncoder().encode(["type": type, "token_hash": tokenHash]))
        return try Self.session(from: data, now: now)
    }

    /// `PUT {auth}/user`: push the Apple full name into GoTrue's user metadata, which the
    /// API mirrors to the display name. Best-effort by design, mirroring signOut(): it
    /// never throws, because a name push must never fail a sign-in. True on a 2xx.
    public func updateUserFullName(_ fullName: String, accessToken: String) async -> Bool {
        var request = URLRequest(
            url: configuration.authBaseURL.appendingPathComponent("user"))
        request.httpMethod = "PUT"
        request.setValue(configuration.publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONEncoder().encode(["data": ["full_name": fullName]])
        guard let (_, response) = try? await session.data(for: request),
            let http = response as? HTTPURLResponse
        else { return false }
        return (200..<300).contains(http.statusCode)
    }

    /// `POST {auth}/logout?scope=local`: revoke this device's refresh token server-side,
    /// not the user's whole token family (global scope would sign the web app and other
    /// devices out at their next refresh). Best-effort by design: local sign-out (Keychain
    /// clear) must succeed even offline, so the caller never awaits a verdict here.
    public func signOut(accessToken: String) async {
        var components = URLComponents(
            url: configuration.authBaseURL.appendingPathComponent("logout"),
            resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "scope", value: "local")]
        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        request.setValue(configuration.publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        _ = try? await session.data(for: request)
    }

    // MARK: - Plumbing

    private struct SendOTPBody: Encodable {
        let email: String
        let createUser: Bool
        /// The captcha token GoTrue reads from `gotrue_meta_security.captcha_token`. Nil
        /// omits the whole block, so a captcha-off build's body is byte-identical to the
        /// pre-captcha form (a synthesized `encodeIfPresent` skips a nil member).
        let captchaToken: String?

        init(email: String, createUser: Bool, captchaToken: String? = nil) {
            self.email = email
            self.createUser = createUser
            self.captchaToken = captchaToken
        }

        /// GoTrue's captcha envelope: `{ "captcha_token": <token> }` under
        /// `gotrue_meta_security`. Encoded only when a token is present.
        private struct MetaSecurity: Encodable {
            let captchaToken: String

            enum CodingKeys: String, CodingKey {
                case captchaToken = "captcha_token"
            }
        }

        enum CodingKeys: String, CodingKey {
            case email
            case createUser = "create_user"
            case metaSecurity = "gotrue_meta_security"
        }

        func encode(to encoder: any Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(email, forKey: .email)
            try container.encode(createUser, forKey: .createUser)
            if let captchaToken {
                try container.encode(
                    MetaSecurity(captchaToken: captchaToken), forKey: .metaSecurity)
            }
        }
    }

    private struct TokenResponse: Decodable {
        let accessToken: String
        let refreshToken: String
        let expiresIn: Double?
        let expiresAt: Double?
        let user: User?

        struct User: Decodable {
            let id: String?
        }

        enum CodingKeys: String, CodingKey {
            case accessToken = "access_token"
            case refreshToken = "refresh_token"
            case expiresIn = "expires_in"
            case expiresAt = "expires_at"
            case user
        }
    }

    private func grant(
        _ grantType: String, body: [String: String], now: Date
    ) async throws -> SupabaseSession {
        let data = try await post(
            path: "token",
            query: [URLQueryItem(name: "grant_type", value: grantType)],
            body: try? JSONEncoder().encode(body))
        return try Self.session(from: data, now: now)
    }

    /// The shared POST leg for every JSON auth call: the apikey header, the body, and the
    /// one error taxonomy (`refused` on a 4xx grant refusal, `invalidResponse` for 5xx and
    /// undecodable frames, `transport` for network weather). Returns the raw 2xx body for
    /// the caller to decode (or ignore, for the send-only `otp` leg). 408/429 stay in the
    /// transient lane: the limiter answered, not the grant evaluator.
    private func post(
        path: String, query: [URLQueryItem]? = nil, body: Data?
    ) async throws -> Data {
        var components = URLComponents(
            url: configuration.authBaseURL.appendingPathComponent(path),
            resolvingAgainstBaseURL: false)!
        components.queryItems = query

        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        request.setValue(configuration.publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw SupabaseAuthError.transport(underlying: error)
        }
        guard let http = response as? HTTPURLResponse else {
            throw SupabaseAuthError.invalidResponse(status: nil)
        }
        guard (200..<300).contains(http.statusCode) else {
            // 408/429 are congestion, not judgment: the refresh token behind a
            // rate-limited grant is still good, so ending the session over one
            // would sign the user out for nothing.
            if (400..<500).contains(http.statusCode), http.statusCode != 408,
                http.statusCode != 429
            {
                throw SupabaseAuthError.refused(status: http.statusCode)
            }
            throw SupabaseAuthError.invalidResponse(status: http.statusCode)
        }
        return data
    }

    /// Decode a token-grant body (the `token` and `verify` legs share it) into a session.
    /// An undecodable 2xx body is `invalidResponse`, the same verdict a malformed grant got.
    private static func session(from data: Data, now: Date) throws -> SupabaseSession {
        guard let decoded = try? JSONDecoder().decode(TokenResponse.self, from: data) else {
            throw SupabaseAuthError.invalidResponse(status: nil)
        }
        // expires_at when the server sends it, else derived from expires_in against
        // the injected clock (older GoTrue omits the absolute form).
        let expiresAt =
            decoded.expiresAt
            ?? now.addingTimeInterval(decoded.expiresIn ?? 3600).timeIntervalSince1970
        return SupabaseSession(
            accessToken: decoded.accessToken,
            refreshToken: decoded.refreshToken,
            expiresAt: expiresAt,
            userId: decoded.user?.id)
    }
}
