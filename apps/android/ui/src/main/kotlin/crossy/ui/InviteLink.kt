// The invite link's two directions, pure and JVM-testable (iOS CrossyUI twins:
// InviteCodeEntry, InviteScan, ShareInvite; PROTOCOL.md §12 "Invite links"; web
// #225, iOS #226). Emit builds the canonical short link the web and iOS clients
// emit; parse digests any recognized form back to the bare code. The host arrives
// as data (the composition root reads BuildConfig.INVITE_HOST) so this module
// pulls in no Android config and its tests run headless. URL parsing rides
// java.net.URI, never android.net.Uri, for the same reason: the :ui unit tests are
// plain JVM (useJUnitPlatform), where android.net.Uri is an unmocked stub.

package crossy.ui

import java.net.URI

/** The read-aloud invite alphabet, mirrored for entry (iOS InviteCodeEntry, via
 *  apps/api/src/games/invite-code.ts: 8 characters from [2-9A-HJ-NP-Z], no 0/1/I/O).
 *  The server owns lookup normalization (ASCII-only uppercase, INV-1; PROTOCOL.md
 *  §12); this mirror only keeps the field honest while typing. Casing is bytewise
 *  ASCII, never locale-aware and never Unicode case mapping (INV-1). */
object InviteCode {
    /** Mirror of INVITE_ALPHABET (apps/api/src/games/invite-code.ts), pinned by test. */
    const val ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

    /** Mirror of INVITE_CODE_LENGTH. */
    const val LENGTH = 8

    /** What the field keeps of raw input: ASCII-uppercased bytewise, filtered to the
     *  alphabet, capped at [LENGTH]. A pasted code with spaces or hyphens survives; a
     *  glyph outside the alphabet (0, 1, I, O included) cannot be part of any code and
     *  is dropped rather than sent to fail server-side. */
    fun sanitize(raw: String): String {
        val kept = StringBuilder()
        for (ch in raw) {
            // ASCII a-z to A-Z by arithmetic (INV-1: bytewise, no locale, no Unicode
            // case mapping); every other scalar is compared as-is.
            val upper = if (ch.code in 0x61..0x7A) (ch.code - 0x20).toChar() else ch
            if (upper !in ALPHABET) continue
            kept.append(upper)
            if (kept.length == LENGTH) break
        }
        return kept.toString()
    }

    /** A sanitized code ready to send: exactly eight alphabet characters. */
    fun isComplete(code: String): Boolean =
        code.length == LENGTH && code.all { it in ALPHABET }
}

/** The scanned or pasted invite's digest (iOS InviteScan). A payload in the wild
 *  carries one of these shapes: the canonical short link the web and iOS apps emit
 *  (`crossy.ing/{CODE}`, a single path segment that IS the code), an old
 *  query-carried share link (`?code=...`), the §12 unfurl link (`/g/{code}`), or a
 *  bare read-aloud code. All digest to the code, the only thing `POST /games/join`
 *  wants (PROTOCOL.md §12), or null when the payload names no room. Casing folds
 *  through InviteCode (bytewise ASCII, INV-1); the server still owns lookup
 *  normalization. */
object InviteScan {
    /** The invite code a payload carries, or null. Strict on bare codes: after
     *  dropping cosmetic separators (spaces, hyphens) the whole payload must BE the
     *  code, since sanitize alone would happily fish eight valid glyphs out of
     *  arbitrary prose and join a room nobody named. */
    fun parse(payload: String): String? {
        val trimmed = payload.trim()
        if (trimmed.isEmpty()) return null

        val stripped = trimmed.filter { it != ' ' && it != '-' }
        val sanitized = InviteCode.sanitize(trimmed)
        if (InviteCode.isComplete(sanitized) && stripped.length == InviteCode.LENGTH) {
            return sanitized
        }

        val uri = runCatching { URI(trimmed) }.getOrNull() ?: return null

        // The share-link form: any URL whose query names a code (`?code=...`). The
        // parameter is explicit intent, so sanitize is enough; a garbage value is a
        // garbage link, never a fall-through to another parse.
        uri.rawQuery?.let { query ->
            val raw = query.split("&")
                .map { it.split("=", limit = 2) }
                .firstOrNull { it[0] == "code" }
                ?.getOrNull(1)
            if (raw != null) {
                val candidate = InviteCode.sanitize(raw)
                return if (InviteCode.isComplete(candidate)) candidate else null
            }
        }

        // Path forms. An opaque URI (no path) yields no segments, so a scheme-only
        // payload never reaches the branches below.
        val segments = (uri.path ?: "").split("/").filter { it.isNotEmpty() }

        // The unfurl form: /g/{code} (§12, the one public route).
        if (segments.size == 2 && segments[0] == "g") {
            val candidate = InviteCode.sanitize(segments[1])
            if (InviteCode.isComplete(candidate) && segments[1].length == InviteCode.LENGTH) {
                return candidate
            }
        }

        // The short-link form: crossy.ing/{CODE}, a single path segment that IS the
        // code. Host-agnostic and shape-gated like the /g/ branch: only a segment
        // that already reads as a valid code matches, so a non-code route
        // (`/puzzles`) falls through to null. The raw-length guard rejects a
        // separator-padded tail (`/AB23CD450`) that only shrinks to eight after
        // dropping glyphs no code can contain.
        if (segments.size == 1) {
            val candidate = InviteCode.sanitize(segments[0])
            if (InviteCode.isComplete(candidate) && segments[0].length == InviteCode.LENGTH) {
                return candidate
            }
        }
        return null
    }
}

/** The room's shareable invite link (iOS ShareInvite): the canonical short form the
 *  web app emits, `https://{host}/{code}`, the invite code as the sole capability a
 *  new visitor needs to self-join. No gameId, no query, no name: a member gets the
 *  room from GET /games/{id}, and no receiving surface reads anything but the code
 *  off the link (InviteScan digests only the code). The host arrives from
 *  configuration (BuildConfig.INVITE_HOST, default crossy.ing per api #222). A null
 *  or empty code means there is nothing to share yet. */
object ShareInvite {
    fun url(host: String, code: String?): String? {
        if (code.isNullOrEmpty()) return null
        return "https://$host/$code"
    }
}
