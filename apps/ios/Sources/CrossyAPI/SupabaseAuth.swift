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

    /// `GET {auth}/authorize?provider=discord&...`: where ASWebAuthenticationSession
    /// navigates. Pure construction, pinned in tests against the configured origin
    /// verbatim (the issuer-trap posture: no origin rewriting anywhere).
    public func authorizeURL(codeChallenge: String) -> URL {
        var components = URLComponents(
            url: configuration.authBaseURL.appendingPathComponent("authorize"),
            resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "provider", value: "discord"),
            URLQueryItem(name: "redirect_to", value: configuration.redirectURL.absoluteString),
            URLQueryItem(name: "code_challenge", value: codeChallenge),
            URLQueryItem(name: "code_challenge_method", value: "s256"),
        ]
        return components.url!
    }

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

    /// `POST {auth}/logout`: revoke the refresh token server-side. Best-effort by
    /// design: local sign-out (Keychain clear) must succeed even offline, so the
    /// caller never awaits a verdict here.
    public func signOut(accessToken: String) async {
        var request = URLRequest(
            url: configuration.authBaseURL.appendingPathComponent("logout"))
        request.httpMethod = "POST"
        request.setValue(configuration.publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        _ = try? await session.data(for: request)
    }

    // MARK: - Plumbing

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
        var components = URLComponents(
            url: configuration.authBaseURL.appendingPathComponent("token"),
            resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "grant_type", value: grantType)]

        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        request.setValue(configuration.publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONEncoder().encode(body)

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
        guard let decoded = try? JSONDecoder().decode(TokenResponse.self, from: data) else {
            throw SupabaseAuthError.invalidResponse(status: http.statusCode)
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
