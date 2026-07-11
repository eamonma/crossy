// The REST client for the section 12 companion (PROTOCOL.md section 12; AD-2 adapter,
// apps/ios/ARCHITECTURE.md sections 2 and 4). Payload shapes are CrossyProtocol's REST
// twins, consumed as-is and never redefined here. Every JSON route in the section 12
// table is bearer-authenticated (the only public route, `GET /g/{code}`, is an HTML
// shell for link unfurlers, not a client API), so every method attaches the bearer.
// Where section 12 prose leaves a detail loose, the live API is mirrored and noted:
// the pagination query parameter names are exactly `limit` and `before`
// (apps/api/src/http/pagination.ts), route mounts are `/puzzles`, `/games`, `/account`
// (apps/api/src/app.ts), and creates answer 201 while everything else answers 200
// (this client accepts any 2xx rather than pinning the split).
//
// Failure taxonomy lives in CrossyAPIError; the auth surface is BearerTokenProviding.
// Timestamps stay ISO 8601 strings end to end, so the pagination cursor is the last
// row's `createdAt` string passed back verbatim, never a parsed-and-reformatted Date.

import CrossyProtocol
import Foundation

/// One page of a cursor-paginated list (`GET /games`, `GET /puzzles`). The wire body is
/// just the rows, newest first; the cursor contract (section 12) is "pass the last
/// row's `createdAt` as the next `before`", which `nextBefore` precomputes. The wire
/// carries no has-more flag, so none is invented: a full final page yields a
/// `nextBefore` whose fetch returns the empty page that ends iteration.
public struct APIPage<Row: Sendable & Equatable>: Sendable, Equatable {
    /// The rows of this page, newest first, at most the clamped `limit`.
    public let rows: [Row]
    /// The `before` cursor for the next page: the last row's `createdAt`, nil when this
    /// page is empty (iteration is over).
    public let nextBefore: String?

    public init(rows: [Row], nextBefore: String?) {
        self.rows = rows
        self.nextBefore = nextBefore
    }
}

/// The REST client. A value: injected base URL (the core API origin), injected token
/// source, injected `URLSession` (tests stub via `URLProtocol`). All methods are
/// async/throws and throw `CrossyAPIError` only. The availability floor is the async
/// URLSession API's (the manifest declares no platforms and this phase does not edit it).
@available(macOS 12.0, iOS 15.0, tvOS 15.0, watchOS 8.0, *)
public struct CrossyAPIClient: Sendable {
    private let baseURL: URL
    private let tokenProvider: any BearerTokenProviding
    private let session: URLSession

    public init(
        baseURL: URL,
        tokenProvider: any BearerTokenProviding,
        session: URLSession = .shared
    ) {
        self.baseURL = baseURL
        self.tokenProvider = tokenProvider
        self.session = session
    }

    // MARK: - Puzzles (section 12: POST /puzzles, GET /puzzles)

    /// `POST /puzzles`: ingest an XWord Info JSON document, uploaded verbatim. The body
    /// is a third-party document whose schema is ingestion's to pin (section 12), so it
    /// is `Data`, not a typed payload. Rejections arrive as `.api` with the named
    /// ingestion codes (422) or `VALIDATION` (400).
    public func createPuzzle(xwordInfoDocument: Data) async throws -> PuzzleView {
        try await send(
            Endpoint(method: "POST", path: ["puzzles"], body: xwordInfoDocument))
    }

    /// `GET /puzzles`: the caller's uploaded puzzles, newest first. `limit` is clamped
    /// server-side to [1, 100] (default 50); `before` is the `createdAt` cursor
    /// (`APIPage.nextBefore`), strictly-before filtering.
    public func listPuzzles(
        limit: Int? = nil, before: String? = nil
    ) async throws -> APIPage<PuzzleSummary> {
        let response: PuzzlesListResponse = try await send(
            Endpoint(method: "GET", path: ["puzzles"], query: pageQuery(limit, before)))
        return APIPage(
            rows: response.puzzles, nextBefore: response.puzzles.last?.createdAt)
    }

    // MARK: - Games (section 12: POST /games, GET /games, joins, view, lifecycle)

    /// `POST /games`: create a game from an ingested puzzle (full account; the creator
    /// is seated host). The optional `name` rides in the typed request, absent when nil.
    public func createGame(_ body: CreateGameRequest) async throws -> CreateGameResponse {
        try await send(Endpoint(method: "POST", path: ["games"], body: try encode(body)))
    }

    /// `GET /games`: the caller's games (membership join), most-recently-active first
    /// within the page (§12). The page is selected by createdAt but shown by activity, so
    /// the cursor is the server-computed `nextBefore` (the page-minimum createdAt), not the
    /// reordered last row. Prefer that field; fall back to the last row's `createdAt` only
    /// for an older server that omits it (before activity ordering shipped), where the two
    /// coincide. A null `nextBefore` on a full response means the list is exhausted.
    public func listGames(
        limit: Int? = nil, before: String? = nil
    ) async throws -> APIPage<GameSummary> {
        let response: GamesListResponse = try await send(
            Endpoint(method: "GET", path: ["games"], query: pageQuery(limit, before)))
        // A server that sent the cursor key (current server) is authoritative: its value, or null
        // to mean the list is exhausted. Only fall back to the last row's createdAt for an older
        // server that omitted the key entirely (before activity ordering, where the two coincide).
        let nextBefore =
            response.hasCursor ? response.nextBefore : response.games.last?.createdAt
        return APIPage(rows: response.games, nextBefore: nextBefore)
    }

    /// `POST /games/join`: join by invite code alone; the code is the lookup key and
    /// the response carries the resolved `gameId`. The code is sent verbatim: the
    /// server owns normalization (ASCII-only uppercase plus trim, INV-1), and mirroring
    /// it here would just shadow the contract.
    public func joinGame(code: String) async throws -> GameMembershipResponse {
        try await send(
            Endpoint(
                method: "POST", path: ["games", "join"],
                body: try encode(JoinGameRequest(code: code))))
    }

    /// `POST /games/{id}/join`: join a known game, the code as capability.
    public func joinGame(gameId: String, code: String) async throws
        -> GameMembershipResponse
    {
        try await send(
            Endpoint(
                method: "POST", path: ["games", gameId, "join"],
                body: try encode(JoinGameRequest(code: code))))
    }

    /// `GET /games/{id}`: the member-only game view (solution-stripped puzzle,
    /// membership, session endpoint, invite code).
    public func game(_ gameId: String) async throws -> GameView {
        try await send(Endpoint(method: "GET", path: ["games", gameId]))
    }

    /// `POST /games/{id}/role`: self role change. The only server-supported transition
    /// is spectator to solver; any other target is refused `VALIDATION`, and a guest is
    /// refused `FULL_ACCOUNT_REQUIRED`.
    public func changeRole(gameId: String, to role: Role) async throws
        -> GameMembershipResponse
    {
        try await send(
            Endpoint(
                method: "POST", path: ["games", gameId, "role"],
                body: try encode(RoleChangeRequest(role: role))))
    }

    /// `DELETE /games/{id}/members/{userId}`: kick (host only; never the host
    /// themselves). Removes membership and writes the denylist in one transaction
    /// server-side.
    public func kickMember(gameId: String, userId: String) async throws -> KickResponse {
        try await send(
            Endpoint(method: "DELETE", path: ["games", gameId, "members", userId]))
    }

    /// `POST /games/{id}/abandon`: terminal state via the session service (host only).
    /// No request body; the route reads none.
    public func abandonGame(gameId: String) async throws -> AbandonResponse {
        try await send(Endpoint(method: "POST", path: ["games", gameId, "abandon"]))
    }

    // MARK: - Live Activity push (PROTOCOL.md section 12a)

    /// `POST /games/{gameId}/live-activity-tokens`: register the per-activity APNs update
    /// token so the push emitter can drive the island (section 12a). Member-gated,
    /// upsert on the token, `204` (no body). The `path` and `{token, environment}` body
    /// come from `LiveActivityTokenRegistrar` (CrossyProtocol), so this method stays a
    /// route description and the encoding and environment pick stay headlessly tested.
    public func registerLiveActivityToken(
        path: [String], _ body: LiveActivityTokenRegistration
    ) async throws {
        try await sendNoContent(
            Endpoint(method: "POST", path: path, body: try encode(body)))
    }

    /// `DELETE /games/{gameId}/live-activity-tokens/{token}`: unregister a token when the
    /// activity ends (section 12a). Idempotent server-side (`204` even when the row is
    /// gone) and scoped to the caller's own rows, so a best-effort delete never has to
    /// check first. The `path` (token included) comes from `LiveActivityTokenRegistrar`.
    public func unregisterLiveActivityToken(path: [String]) async throws {
        try await sendNoContent(Endpoint(method: "DELETE", path: path))
    }

    // MARK: - Account (section 12: DELETE /account)

    /// `DELETE /account`: tombstone the caller's own account, with host succession or
    /// auto-abandon per hosted game.
    public func deleteAccount() async throws -> DeleteAccountResponse {
        try await send(Endpoint(method: "DELETE", path: ["account"]))
    }

    // MARK: - Request plumbing

    private struct Endpoint {
        var method: String
        var path: [String]
        var query: [URLQueryItem] = []
        var body: Data? = nil
    }

    /// The two pagination query parameters, named exactly as the API reads them
    /// (`limit`, `before`; apps/api/src/http/pagination.ts). Absent parameters are
    /// omitted, not sent empty: the server treats absent and empty alike, but omission
    /// is the honest encoding of "not asked".
    private func pageQuery(_ limit: Int?, _ before: String?) -> [URLQueryItem] {
        var items: [URLQueryItem] = []
        if let limit {
            items.append(URLQueryItem(name: "limit", value: String(limit)))
        }
        if let before {
            items.append(URLQueryItem(name: "before", value: before))
        }
        return items
    }

    private func encode(_ body: some Encodable) throws -> Data {
        // Encoding a CrossyProtocol request type cannot realistically fail (no floats,
        // no dates), but the throw is kept honest rather than force-tried.
        try JSONEncoder().encode(body)
    }

    private func requestURL(_ endpoint: Endpoint) -> URL {
        var url = baseURL
        for component in endpoint.path {
            url.appendPathComponent(component)
        }
        guard !endpoint.query.isEmpty,
            var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else { return url }
        components.queryItems = endpoint.query
        return components.url ?? url
    }

    /// One round trip: token, request, status split, decode. The section 12 contract
    /// in one place so every method above stays a route description.
    private func send<Response: Decodable>(_ endpoint: Endpoint) async throws -> Response {
        let (data, status) = try await perform(endpoint)
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw CrossyAPIError.decodingFailed(status: status, underlying: error)
        }
    }

    /// A round trip whose success carries no body: the `204` register and unregister
    /// routes (section 12a). The status split still applies (a non-2xx is the same typed
    /// envelope), but a 2xx body is discarded rather than decoded, so an empty `204`
    /// never surfaces as a spurious decode failure.
    private func sendNoContent(_ endpoint: Endpoint) async throws {
        _ = try await perform(endpoint)
    }

    /// The shared trip both `send` variants ride: resolve the token, build and issue the
    /// request, and split on status, returning the raw 2xx body and its status code. A
    /// non-2xx throws the typed section 12 envelope here, so neither caller repeats it.
    private func perform(_ endpoint: Endpoint) async throws -> (data: Data, status: Int) {
        let token: String
        do {
            token = try await tokenProvider.currentToken()
        } catch {
            throw CrossyAPIError.tokenUnavailable(underlying: error)
        }

        var request = URLRequest(url: requestURL(endpoint))
        request.httpMethod = endpoint.method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body = endpoint.body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw CrossyAPIError.transport(underlying: error)
        }

        guard let http = response as? HTTPURLResponse else {
            throw CrossyAPIError.invalidResponse(status: nil)
        }
        guard (200..<300).contains(http.statusCode) else {
            // Non-2xx is the section 12 envelope, keyed on the stable code. The
            // envelope's `error` stays a plain string, so a code outside today's
            // vocabulary still decodes and surfaces typed (degraded, never crashed).
            guard let envelope = try? JSONDecoder().decode(APIErrorEnvelope.self, from: data)
            else {
                throw CrossyAPIError.invalidResponse(status: http.statusCode)
            }
            throw CrossyAPIError.api(status: http.statusCode, envelope: envelope)
        }

        return (data, http.statusCode)
    }
}
