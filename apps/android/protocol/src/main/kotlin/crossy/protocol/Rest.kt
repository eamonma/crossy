// The REST companion (PROTOCOL.md §12). Twin of apps/ios REST.swift. The WebSocket carries
// gameplay only; everything else is REST on the core API, bearer-authenticated with the same
// tokens. PROTOCOL.md §12 lists the routes and pins the error vocabulary; the payload field
// lists are the API's own contract (apps/api/src/{games,puzzles,identity}/routes.ts,
// http/errors.ts), mirrored here field for field, and the fixtures under src/test pin them.
//
// Same posture as the wire messages. Display metadata (`name`, `title`, `author`) is shown back
// verbatim: never normalized or compared, so INV-1's ASCII-only casing rule does not apply to it
// (§12), and none of it is a solution (INV-6 untouched). Timestamps stay ISO 8601 strings (§3):
// parsing is a consumer concern. The API writes user-content fields it holds as SQL NULL as
// explicit JSON nulls, so those fields carry a null default AND @EncodeDefault(ALWAYS): an absent
// key decodes to null, and a null re-encodes as the explicit null the current server sends.

@file:OptIn(ExperimentalSerializationApi::class)

package crossy.protocol

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// MARK: - Error envelope (PROTOCOL.md §12)

/**
 * Every REST error code (PROTOCOL.md §12: the general vocabulary plus the named ingestion
 * rejections). Twin of `ApiErrorCode` (apps/api/src/http/errors.ts). The constant names are the
 * stable wire strings a client keys on, never prose; `httpStatus` is the §12 tables' status.
 */
public enum class APIErrorCode(public val httpStatus: Int) {
    UNAUTHORIZED(401),
    FULL_ACCOUNT_REQUIRED(403),
    NOT_PARTICIPANT(403),
    DENIED(403),
    FORBIDDEN(403),
    GAME_NOT_FOUND(404),
    PUZZLE_NOT_FOUND(404),
    VALIDATION(400),
    INTERNAL(500),

    // Named puzzle-ingestion rejections (§12; DESIGN.md §7, SP5). All 422.
    UNSOLVABLE_CELL(422),
    REBUS_TOO_LONG(422),
    OVERSIZE_GRID(422),
    AMBIGUOUS_SOLUTION(422),
    DEGENERATE_GRID(422),
    DIAGRAMLESS(422),

    // Named display-name rejections (§12; docs/design/name-onboarding §7.2). All 422: the body is
    // well-formed JSON (a malformed body is 400 VALIDATION) but the name violates a domain rule the
    // person can read and fix. INV-1 casing does NOT apply to names (it is cell-values only).
    NAME_REQUIRED(422),
    NAME_TOO_LONG(422),
    NAME_INVALID(422),

    // Named personal-reaction-set rejections (§9, §12; DESIGN.md D25). All 422: the body is
    // well-formed JSON but the `reactionSet` violates a domain rule the person can read and fix
    // (the NAME_* posture). The send-gate spec (ReactionSetSpec) names these same rules at the edge,
    // but the server stays the authority the UI surfaces (its RGI list is the truth the heuristic
    // only approximates). INV-1 casing does NOT apply (the set is byte-exact, never normalized).
    REACTION_SET_LENGTH(422),
    REACTION_SET_INVALID(422),
    REACTION_SET_DUPLICATE(422),

    // The write window is spent (PATCH /me is rate-limited per user); carries a Retry-After header.
    RATE_LIMITED(429),
    ;

    public companion object {
        /** The typed code for a wire string, or null for a code this client does not know. */
        public fun fromWire(code: String): APIErrorCode? = entries.firstOrNull { it.name == code }
    }
}

/**
 * The §12 error body: `{ error, message }` plus the matching HTTP status. `error` stays a String
 * so a code added to the vocabulary later (§12 names barred/uniclue as codeless today) degrades
 * to an unrecognized-but-present code instead of a decode failure; `code` is the typed view, null
 * exactly when the string is outside the current vocabulary.
 */
@Serializable
public data class APIErrorEnvelope(
    val error: String,
    val message: String,
) {
    /** The typed code, null for a code this client does not know. Never serialized (no field). */
    public val code: APIErrorCode? get() = APIErrorCode.fromWire(error)
}

// MARK: - Puzzles (PROTOCOL.md §12: POST /puzzles, GET /puzzles)

/**
 * The `POST /puzzles` (201) response: the ingested puzzle's id and its client view. `puzzle` is
 * `ClientPuzzle`: no solution field, structurally (INV-6). Twin of `PuzzleView`. The request body
 * is not modeled here: it is a third-party document owned by ingestion's ACL (§12), uploaded
 * verbatim.
 */
@Serializable
public data class PuzzleView(
    val puzzleId: String,
    val puzzle: ClientPuzzle,
)

/**
 * Detected feature flags stored with a puzzle (DESIGN.md §7, §9), surfaced on `GET /puzzles`
 * rows. Twin of `PuzzleFeatures`; §12 lists the field without pinning its shape, so the ACL's is
 * mirrored.
 */
@Serializable
public data class PuzzleFeatures(
    val rebus: Boolean,
    val circles: Boolean,
    val shadedCircles: Boolean,
)

/**
 * One row of `GET /puzzles` (§12): a puzzle the caller uploaded, geometry only, no solution
 * (INV-6). `title`/`author` are display metadata, null when the document carried none
 * (nullable-and-present: no default, required key, explicit null). Twin of `PuzzleSummary`.
 */
@Serializable
public data class PuzzleSummary(
    val puzzleId: String,
    val createdAt: String,
    val rows: Int,
    val cols: Int,
    val features: PuzzleFeatures,
    val title: String?,
    val author: String?,
)

/**
 * The `GET /puzzles` response body: `{ puzzles }`, newest first, cursor-paginated (§12: `limit`
 * clamped to [1, 100], `before` an ISO 8601 `createdAt`; both query parameters, not body fields).
 */
@Serializable
public data class PuzzlesListResponse(
    val puzzles: List<PuzzleSummary>,
)

// MARK: - Games (PROTOCOL.md §12: POST /games, GET /games, joins, view, lifecycle)

/**
 * The `POST /games` request: `{puzzleId, name?}` (§12). `name` is an optional display label
 * (trimmed and capped server-side at 80 chars; absent, null, or empty all read as unnamed), so
 * absent-optional encoding (a null default) is exact.
 */
@Serializable
public data class CreateGameRequest(
    val puzzleId: String,
    val name: String? = null,
)

/**
 * The `POST /games` (201) response (§12: "returns the game, its invite code, and the `name`").
 * `name` is nullable-and-present (null when unnamed), and the creator is seated `host`. Twin of
 * the games route response.
 */
@Serializable
public data class CreateGameResponse(
    val gameId: String,
    val inviteCode: String,
    val puzzleId: String,
    val name: String?,
    val createdBy: String,
    val role: Role,
)

/**
 * One row of `GET /games` (§12): a game the caller is a member of. Deliberately no lifecycle
 * `status` (session-owned `game_state`; a planned additive extension) and no board. `puzzle`
 * carries only INV-6-safe geometry plus the display `title` and the black-square silhouette.
 * Twin of `GameSummary`.
 */
@Serializable
public data class GameSummary(
    val gameId: String,
    val name: String?,
    /** The caller's own role in this game. */
    val role: Role,
    val createdAt: String,
    val createdBy: String,
    /** Total members (all roles); equals `members.size` on a current server. */
    val memberCount: Int,
    val puzzle: PuzzleRef,
    /**
     * The full membership as display identity, join-ordered (first joiner first, §12). Additive
     * and optional on the wire (§14): an older server omits it, which decodes to empty; a current
     * server always sends it (even empty), so @EncodeDefault(ALWAYS) keeps the key on re-encode.
     */
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val members: List<Member> = emptyList(),
    /**
     * The game's invite code (§12), under the game view's member-only rule (the list is
     * member-scoped, so every row's reader is a member). Absent-optional: an older server omits
     * it (decodes to null), and a null re-encodes to an absent key, never a null (the server
     * never sends a null code).
     */
    val inviteCode: String? = null,
    /**
     * When the game completed (ISO 8601), or null while ongoing AND null for an abandoned game,
     * which never completed (§12). Absent-tolerant on decode (an older server omits it, reads as
     * ongoing), explicit null on encode (@EncodeDefault ALWAYS): a bare timestamp, so INV-6 holds.
     */
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val completedAt: String? = null,
    /**
     * When a host ended the game (ISO 8601), or null unless it was abandoned (§12). The twin
     * terminal timestamp to `completedAt` and mutually exclusive with it (a terminal game is
     * completed or ended, never both): a non-null value shelves the room as ended rather than
     * leaving it in the live shelf, both null reads ongoing. Read from the session-owned
     * `game_state.abandoned_at` under the same SELECT-only grant, a bare timestamp, so INV-6 holds.
     * Same absent-tolerant decode, explicit-null encode posture as `completedAt` (§14: an older
     * server that omits it, or sends null, reads as not-ended).
     */
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val abandonedAt: String? = null,
    /**
     * The game's last activity: the newest board event's ISO 8601 timestamp, or null when no one
     * has played yet (§12). `MAX(cell_events.at)`, an INV-6-safe aggregate. Same absent-tolerant
     * decode, explicit-null encode posture as `completedAt`.
     */
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val lastActivityAt: String? = null,
) {
    /**
     * The INV-6-safe puzzle summary on a game row: geometry, display title, and the black-square
     * silhouette. `mask` is the puzzle's pattern only (§12): an array of `rows` strings, each
     * `cols` characters of `#` (block) and `.` (playable cell), derived server-side from geometry
     * and block positions, never the solution. Additive and optional (§14): an older server that
     * omits it decodes to empty, and a current server always sends it (@EncodeDefault ALWAYS).
     */
    @Serializable
    public data class PuzzleRef(
        val puzzleId: String,
        val rows: Int,
        val cols: Int,
        val title: String?,
        @EncodeDefault(EncodeDefault.Mode.ALWAYS) val mask: List<String> = emptyList(),
    )

    /**
     * One member on a row (§12): display identity only, the §4 participant's naming. `name` is the
     * server-resolved display name and never null on the wire. `avatarUrl` is the same opaque
     * nullable field as §4: the current server writes a mirror NULL as an explicit JSON null, so
     * encode keeps the key (null included) to keep the fixture round trip wire-honest, while decode
     * also tolerates an absent key (§14); both read as none. `role` is the member's seat, so the
     * standing solvers-only filters apply from it alone (a guest seats spectator; there is NO guest
     * flag on the wire, §12).
     */
    @Serializable
    public data class Member(
        val userId: String,
        val name: String,
        val role: Role,
        @EncodeDefault(EncodeDefault.Mode.ALWAYS) val avatarUrl: String? = null,
    )
}

/**
 * The `GET /games` response body: `{ games, nextBefore }`, most-recently-active first within the
 * page, cursor-paginated (§12; `limit`/`before` are query parameters). The page is SELECTED by
 * createdAt but SHOWN by activity, so the visual last row is not the page's oldest createdAt;
 * `nextBefore` is the server-computed next cursor (the page-minimum createdAt), null when the list
 * is exhausted. A client MUST page by `nextBefore`, never by re-deriving a cursor from the
 * reordered rows (§12).
 *
 * The field is additive (§14) but its ABSENCE and its NULL mean different things, so decoding
 * tracks presence, not just value (GamesListResponseSerializer, below). Key present with a value:
 * the cursor. Key present and null: the list is exhausted, stop. Key absent (an older server that
 * predates activity ordering): `hasCursor` is false and the caller falls back to the last row's
 * createdAt, valid there because that server did not reorder the page.
 */
@Serializable(with = GamesListResponseSerializer::class)
public data class GamesListResponse(
    val games: List<GameSummary>,
    /** The next cursor when present; null both when the server sent null (exhausted) and when it
     * omitted the key. Read `hasCursor` to tell those apart. */
    val nextBefore: String? = null,
    /** True when the server included the `nextBefore` key at all (present, value or null). False
     * only for an older server that omits it. */
    val hasCursor: Boolean = true,
)

/**
 * The hand-written `GET /games` codec: preserves the present-null-vs-absent distinction a plain
 * optional cannot. Decode records key presence in `hasCursor`; encode emits the key only when the
 * server would have (hasCursor), so a decode/encode round trip keeps present-null and absent apart.
 */
public object GamesListResponseSerializer : KSerializer<GamesListResponse> {
    override val descriptor: SerialDescriptor =
        buildClassSerialDescriptor("crossy.protocol.GamesListResponse")

    private val gamesSerializer = ListSerializer(GameSummary.serializer())

    override fun deserialize(decoder: Decoder): GamesListResponse {
        val input = decoder as? kotlinx.serialization.json.JsonDecoder
            ?: throw SerializationException("GamesListResponse decodes from JSON only")
        val obj = input.decodeJsonElement().jsonObject
        val games = input.json.decodeFromJsonElement(
            gamesSerializer,
            obj["games"] ?: throw SerializationException("games is required"),
        )
        val hasCursor = obj.containsKey("nextBefore")
        val cursorElement = obj["nextBefore"]
        val nextBefore =
            if (cursorElement == null || cursorElement is JsonNull) null
            else cursorElement.jsonPrimitive.content
        return GamesListResponse(games, nextBefore, hasCursor)
    }

    override fun serialize(encoder: Encoder, value: GamesListResponse) {
        val output = encoder as? kotlinx.serialization.json.JsonEncoder
            ?: throw SerializationException("GamesListResponse encodes to JSON only")
        val obj = buildJsonObject {
            put("games", output.json.encodeToJsonElement(gamesSerializer, value.games))
            // Emit the key when the server would have (hasCursor), preserving present-null vs absent.
            if (value.hasCursor) {
                put("nextBefore", value.nextBefore?.let { JsonPrimitive(it) } ?: JsonNull)
            }
        }
        output.encodeJsonElement(obj)
    }
}

/**
 * The request body of both joins (§12): `POST /games/join` (code alone; the code is the lookup
 * key) and `POST /games/{id}/join` (code as capability for a known id).
 */
@Serializable
public data class JoinGameRequest(
    val code: String,
)

/**
 * The `{gameId, role, userId}` membership result (§12), shared verbatim by `POST /games/join`,
 * `POST /games/{id}/join`, and `POST /games/{id}/role`: the two joins seat with identical
 * semantics, and the role upgrade returns the same shape.
 */
@Serializable
public data class GameMembershipResponse(
    val gameId: String,
    val userId: String,
    val role: Role,
)

/**
 * The optional `POST /games/{id}/role` request body (§12). The only supported upgrade is spectator
 * to solver; an absent body means the same thing, and any other target role is a server-side
 * VALIDATION.
 */
@Serializable
public data class RoleChangeRequest(
    val role: Role,
)

/** The `DELETE /games/{id}/members/{userId}` (kick) response (§12): the game and the removed member. */
@Serializable
public data class KickResponse(
    val gameId: String,
    val removed: String,
)

/** The `POST /games/{id}/abandon` response (§12): the game settles into its terminal state. */
@Serializable
public data class AbandonResponse(
    val gameId: String,
    val status: GameStatus,
)

/**
 * The `POST /games/{id}/share` response (§12; design/post-game/SHARE.md): the game's public
 * completion share link. `shareUrl` is `{share-origin}/s/{token}` and `token` is the 256-bit
 * URL-safe capability. Idempotent server-side (one active token per game), member-and-completed
 * gated exactly as the analysis endpoint, and carrying no solution content (INV-6). The token is a
 * bare capability string, never parsed here. No iOS twin yet (Android leads the native completion
 * card; web ships the S1 client card).
 */
@Serializable
public data class ShareResponse(
    val shareUrl: String,
    val token: String,
)

/**
 * The `GET /games/{id}` view (§12): solution-stripped puzzle, membership, session endpoint, the
 * optional `name`, and the member-only `inviteCode`. Twin of `GameView`.
 */
@Serializable
public data class GameView(
    val gameId: String,
    val createdBy: String,
    val createdAt: String,
    /** Optional room display name (user content); null for an unnamed game. */
    val name: String?,
    /** Returned only to members (any role: every member joined via it). */
    val inviteCode: String,
    /** `ClientPuzzle`: solution-stripped by type (INV-6). */
    val puzzle: ClientPuzzle,
    val members: List<Member>,
    val session: SessionEndpoint,
) {
    /** One membership row on the view. `avatarUrl` is the same opaque nullable field the
     * participant carries (§4, §12), absent-optional: absent or null decodes to null and a null
     * re-encodes to an absent key, so a pre-avatar view round-trips byte-for-byte. */
    @Serializable
    public data class Member(
        val userId: String,
        val role: Role,
        val joinedAt: String,
        val avatarUrl: String? = null,
    )

    /** Where to open the game's WebSocket (§2: `wss://{session-host}/games/{gameId}/ws`). */
    @Serializable
    public data class SessionEndpoint(
        val ws: String,
    )
}

/**
 * The `GET /games/{id}/analysis` post-game bundle (§12): the completed surface in one fetch.
 * `owners` is the mosaic's owner map (cell index to owning userId), `momentum` is the room's tempo
 * (a fixed-length peak-normalized curve plus the solve's duration), `moments` are the three named
 * beats, and `titles` are the solver superlatives (design/post-game/TITLES.md). Twin of
 * `AnalysisView`.
 *
 * Every field carries userIds, cells, and numbers only, so it is INV-6-safe by construction: the
 * type has nowhere to hold a solution value or a raw event, so a leak is a compile error here,
 * never a missed runtime strip.
 */
@Serializable
public data class AnalysisView(
    /** The mosaic owner map (§12): the first-correct owner per solved cell. JSON object keys are
     * always strings, so this is `Map<String, String>` (cell index as string to userId); read
     * `ownersByCell` for the integer-keyed view. */
    val owners: Map<String, String>,
    val momentum: Momentum,
    val moments: Moments,
    /**
     * The solver superlatives (§12), ordered by ladder rank: at most one per solver, at most one per
     * key, empty when fewer than two solvers wrote (the solo rule). Additive-optional (§14): a
     * current server always writes the key, and the null default also tolerates an older server that
     * omits it, which reads the same as no titles at all (null re-encodes absent). Twin of iOS
     * `AnalysisView.titles`.
     */
    val titles: List<Title>? = null,
    /**
     * The sittings partition (§12; DESIGN.md D29). Additive-optional: a client MUST tolerate the
     * field's absence (an older cached bundle) and degrade to rendering without seams, so an omitted
     * key decodes to null (never a decode failure) and a null re-encodes absent. Twin of iOS
     * `AnalysisView.sittings`.
     */
    val sittings: Sittings? = null,
) {
    /** The room's tempo (§12). `samples` is a fixed-length 40-bucket curve, each peak-normalized
     * into [0, 1]; `durationSeconds` is the solve's wall span. Numbers only, so INV-6 holds. */
    @Serializable
    public data class Momentum(
        val durationSeconds: Double,
        val samples: List<Double>,
    )

    /** One named beat (§12): a cell that fell, its owning userId, and when. A cell index plus a
     * userId plus a number, never a letter, so INV-6 holds. */
    @Serializable
    public data class Beat(
        val cell: Int,
        val userId: String,
        val atSeconds: Double,
    )

    /** The pivot (§12): the stall before the break, the break itself, and the burst that followed.
     * Numbers only, so INV-6 holds. */
    @Serializable
    public data class TurningPoint(
        val stallSeconds: Double,
        val breakSeconds: Double,
        val burst: Int,
    )

    /** The three named beats (§12). Each is nullable-and-present on the wire: the server always
     * writes the key, with an explicit JSON null when the beat is absent (a solve too short to have
     * one). Absent-tolerant on decode, explicit null on encode (@EncodeDefault ALWAYS), so a
     * decode/encode round trip preserves the null wire-honestly. */
    @Serializable
    public data class Moments(
        @EncodeDefault(EncodeDefault.Mode.ALWAYS) val firstToFall: Beat? = null,
        @EncodeDefault(EncodeDefault.Mode.ALWAYS) val lastSquare: Beat? = null,
        @EncodeDefault(EncodeDefault.Mode.ALWAYS) val turningPoint: TurningPoint? = null,
    )

    /**
     * One solver superlative (§12; design/post-game/TITLES.md): a userId, a lowercase-kebab title
     * key from the pinned ladder, and the title's own count (or null for a rung that cites none).
     * Keys and numbers only, never a letter, so INV-6 holds. `title` is deliberately a plain String,
     * NOT an enum: a client MUST ignore an unknown key (§12, how the ladder grows without client
     * lockstep), so the twin carries the string verbatim and the render layer decides what it knows.
     * `evidence` is nullable-and-present: the server always writes the key (an explicit JSON null
     * when the rung cites nothing), so it carries @EncodeDefault(ALWAYS) to re-emit the explicit
     * null, the Moments posture. Twin of iOS `AnalysisView.Title`. */
    @Serializable
    public data class Title(
        val userId: String,
        val title: String,
        @EncodeDefault(EncodeDefault.Mode.ALWAYS) val evidence: Int? = null,
    )

    /**
     * The sittings partition (§12; DESIGN.md D29): `count` sittings, one `spans` entry per sitting on
     * the ACTIVE axis (the same axis as `momentum.durationSeconds`, so a client places ribbon seam
     * ticks by lookup; contiguous, first start 0, last end the duration), and `wallSeconds`, the
     * wall-clock trace span the pre-D29 `durationSeconds` reported, kept for flavor copy only. Numbers
     * only, so INV-6 holds. Twin of iOS `AnalysisView.Sittings`. */
    @Serializable
    public data class Sittings(
        val count: Int,
        val spans: List<Span>,
        val wallSeconds: Double,
    ) {
        /** One sitting's reach on the active axis. A sitting holding no trace entry clamps to a
         * zero-width span at the axis edge (§12), which draws nothing. Twin of iOS `Sittings.Span`. */
        @Serializable
        public data class Span(
            val startSeconds: Double,
            val endSeconds: Double,
        )
    }

    /** The owner map with its keys parsed back to cell indices. A non-integer key is dropped
     * defensively (a current server sends only integer keys), so this never throws on a bad key. */
    public val ownersByCell: Map<Int, String>
        get() = owners.mapNotNull { (key, userId) -> key.toIntOrNull()?.let { it to userId } }.toMap()
}

// MARK: - Account (PROTOCOL.md §12: DELETE /account)

/**
 * The `DELETE /account` response: the caller's own account is tombstoned, with host succession or
 * auto-abandon per hosted game (§12; DESIGN.md §8). `successions` counts games handed to a new
 * host, `abandoned` lists games auto-abandoned because no eligible successor remained.
 */
@Serializable
public data class DeleteAccountResponse(
    val userId: String,
    val tombstoned: Boolean,
    val successions: Int,
    val abandoned: List<String>,
    val vendorDeleted: Boolean,
)

// MARK: - Self display identity (PROTOCOL.md §12: GET /me, PATCH /me)

/**
 * The `GET /me` / `PATCH /me` response: the caller's own display identity, the read the onboarding
 * trigger confirms against and the Settings editor loads from (docs/design/name-onboarding §7). Twin
 * of iOS `MeResponse`; field list per apps/api/src/identity/me.ts.
 *
 * `displayName` is the raw app-DB value and MAY be null: this is the one place a null name crosses
 * the wire on purpose, so a client can detect a nameless account and onboard (the gameplay wire in
 * §4 stays non-null). Both nullable fields here are nullable-and-present: the server always writes
 * the key (with an explicit JSON null when empty), so they carry NO default (the key is required on
 * decode and an explicit null is written on encode, the §3 nullable-and-present posture).
 * `needsName` is the server-computed trigger (`!isAnonymous && display_name IS NULL`), the
 * authoritative "are you nameless" answer the client acts on rather than re-deriving.
 */
@Serializable
public data class MeResponse(
    val userId: String,
    val displayName: String?,
    val isAnonymous: Boolean,
    val avatarUrl: String?,
    val needsName: Boolean,
    /**
     * The caller's personal reaction set: five emoji graphemes in slot order, or null for the
     * default five (PROTOCOL.md §9, §12; D25). A current server always writes the key (an explicit
     * JSON null until an account chooses its own five), so this carries the same nullable-and-present
     * posture as `completedAt`: @EncodeDefault(ALWAYS) writes the explicit null on encode. The null
     * default ALSO tolerates an older server that omits the key (§14), which reads the same as null:
     * the defaults. Twin of iOS `MeResponse.reactionSet`.
     */
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val reactionSet: List<String>? = null,
)

/**
 * The `PATCH /me` request body: the caller sets their own display name. A single `displayName`
 * field, sent verbatim; the server owns canonicalization and validation (§5), so mirroring that in
 * the type would only shadow the contract. Twin of iOS `UpdateDisplayNameRequest`.
 *
 * The two /me writers are separate, single-field request bodies (this and [UpdateReactionSetRequest])
 * rather than one `{displayName?, reactionSet?}` struct: PROTOCOL.md §12's partial-update shape is
 * realized compositionally, one write per field, so each field's presence on the wire is decided by
 * WHICH request is sent. A display-name write omits `reactionSet` entirely (the server leaves it
 * untouched); a reaction-set write omits `displayName`. Twin of the iOS split (UpdateDisplayNameRequest
 * / UpdateReactionSetRequest).
 */
@Serializable
public data class UpdateDisplayNameRequest(
    val displayName: String,
)

/**
 * The `PATCH /me` request body for the personal reaction set (§9, §12; D25): five graphemes in slot
 * order, or null to reset to the defaults. `reactionSet` carries NO default, so the key is ALWAYS
 * written (explicitNulls keeps a null as an explicit null): null is a VALUE here, the reset command,
 * never an omission. This is the absent-vs-null distinction PROTOCOL.md §12 pins — an omitted key
 * would read as "nothing to update" (400 VALIDATION on an otherwise empty patch), while an explicit
 * `reactionSet: null` resets the column to the default five. The set is sent byte-exact; the server
 * owns validation (the REACTION_SET_* 422s), though ReactionSetSpec.validate lets an editor name the
 * same rule at the edge. Twin of iOS `UpdateReactionSetRequest`.
 */
@Serializable
public data class UpdateReactionSetRequest(
    val reactionSet: List<String>?,
)
