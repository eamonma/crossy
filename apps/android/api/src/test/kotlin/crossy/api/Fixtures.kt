// Fixture-style §12 response bodies, inline. These mirror the shapes CrossyProtocol's snapshot
// fixtures pin (apps/android/protocol/src/test/resources/fixtures/rest), copied here because a
// module's test resources are not on a downstream module's classpath. The client is exercised
// against the same field lists the protocol twins round-trip.

package crossy.api

object Fixtures {
    val GAMES_LIST = """
        {
          "games": [
            {
              "gameId": "7d9f34a2-4b1e-4c3a-9d2f-8a6b5c4d3e2f",
              "name": "Sunday themeless with the crew",
              "role": "host",
              "createdAt": "2026-07-08T12:00:00.000Z",
              "createdBy": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
              "memberCount": 3,
              "members": [
                { "userId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", "name": "Ana", "avatarUrl": "https://cdn.example/avatars/ana.png", "role": "host" },
                { "userId": "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e", "name": "Bo", "avatarUrl": null, "role": "solver" },
                { "userId": "d4e5f6a7-b8c9-4d0e-8f1a-3b4c5d6e7f8a", "name": "Guest", "avatarUrl": null, "role": "spectator" }
              ],
              "inviteCode": "BQ7XKM2A",
              "completedAt": "2026-07-09T18:24:03.000Z",
              "lastActivityAt": "2026-07-09T18:24:03.000Z",
              "puzzle": { "puzzleId": "3f8c2b1a-9e4d-4f6a-b7c8-2d1e0f9a8b7c", "rows": 15, "cols": 15, "title": "Themeless Saturday", "mask": ["....#"] }
            },
            {
              "gameId": "c3d4e5f6-a7b8-4c9d-8e0f-2a3b4c5d6e7f",
              "name": null,
              "role": "spectator",
              "createdAt": "2026-07-07T09:30:00.000Z",
              "createdBy": "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
              "memberCount": 1,
              "members": [
                { "userId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", "name": "Ana", "avatarUrl": "https://cdn.example/avatars/ana.png", "role": "spectator" }
              ],
              "inviteCode": "JW3PZQ9K",
              "completedAt": null,
              "lastActivityAt": null,
              "puzzle": { "puzzleId": "c3d4e5f6-a7b8-4c9d-8e0f-2a3b4c5d6e7f", "rows": 21, "cols": 21, "title": null, "mask": [".#."] }
            }
          ],
          "nextBefore": "2026-07-07T09:30:00.000Z"
        }
    """.trimIndent()

    /** A second games page, older than the first page's last row, without a nextBefore key (an
     *  older server that predates activity ordering, so the client falls back to the last row's
     *  createdAt). */
    val GAMES_LIST_OLDER = """
        {
          "games": [
            {
              "gameId": "d4e5f6a7-b8c9-4d0e-9f1a-3b4c5d6e7f8a",
              "name": null,
              "role": "solver",
              "createdAt": "2026-07-06T08:00:00.000Z",
              "createdBy": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
              "memberCount": 2,
              "puzzle": { "puzzleId": "3f8c2b1a-9e4d-4f6a-b7c8-2d1e0f9a8b7c", "rows": 15, "cols": 15, "title": null }
            }
          ]
        }
    """.trimIndent()

    val GAMES_LIST_EMPTY = """{ "games": [] }"""

    val PUZZLES_LIST = """
        {
          "puzzles": [
            { "puzzleId": "3f8c2b1a-9e4d-4f6a-b7c8-2d1e0f9a8b7c", "createdAt": "2026-07-08T12:00:00.000Z", "rows": 15, "cols": 15, "features": { "rebus": true, "circles": true, "shadedCircles": false }, "title": "Themeless Saturday", "author": "A. Constructor" },
            { "puzzleId": "c3d4e5f6-a7b8-4c9d-8e0f-2a3b4c5d6e7f", "createdAt": "2026-07-07T09:30:00.000Z", "rows": 21, "cols": 21, "features": { "rebus": false, "circles": false, "shadedCircles": false }, "title": null, "author": null }
          ]
        }
    """.trimIndent()

    val PUZZLES_LIST_EMPTY = """{ "puzzles": [] }"""

    val CREATE_GAME_RESPONSE = """
        {
          "gameId": "7d9f34a2-4b1e-4c3a-9d2f-8a6b5c4d3e2f",
          "inviteCode": "BQ7XKM2A",
          "puzzleId": "3f8c2b1a-9e4d-4f6a-b7c8-2d1e0f9a8b7c",
          "name": null,
          "createdBy": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
          "role": "host"
        }
    """.trimIndent()

    val MEMBERSHIP_RESPONSE = """
        { "gameId": "7d9f34a2-4b1e-4c3a-9d2f-8a6b5c4d3e2f", "userId": "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e", "role": "solver" }
    """.trimIndent()

    val GAME_VIEW = """
        {
          "gameId": "7d9f34a2-4b1e-4c3a-9d2f-8a6b5c4d3e2f",
          "createdBy": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
          "createdAt": "2026-07-08T12:00:00.000Z",
          "name": "Sunday themeless with the crew",
          "inviteCode": "BQ7XKM2A",
          "puzzle": {
            "rows": 2, "cols": 2, "blocks": [3], "circles": [0], "shadedCircles": [2],
            "clues": {
              "across": [ { "number": 1, "text": "First across", "cellIndices": [0, 1] }, { "number": 3, "text": "Second across", "cellIndices": [2] } ],
              "down": [ { "number": 1, "text": "First down", "cellIndices": [0, 2] }, { "number": 2, "text": "Second down", "cellIndices": [1] } ]
            }
          },
          "members": [
            { "userId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", "role": "host", "joinedAt": "2026-07-08T12:00:00.000Z" },
            { "userId": "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e", "role": "spectator", "joinedAt": "2026-07-08T12:05:00.000Z" }
          ],
          "session": { "ws": "wss://session.example/games/7d9f34a2-4b1e-4c3a-9d2f-8a6b5c4d3e2f/ws" }
        }
    """.trimIndent()

    val ANALYSIS_VIEW = """
        {
          "owners": { "0": "host", "1": "host", "2": "mate", "3": "host" },
          "momentum": { "durationSeconds": 60, "samples": [0.02,0.05,0.08,0.12,0.15,0.19,0.23,0.28,0.31,0.34,0.36,0.35,0.33,0.3,0.28,0.29,0.32,0.38,0.45,0.52,0.6,0.68,0.75,0.81,0.86,0.9,0.93,0.95,0.97,0.98,1.0,0.96,0.88,0.77,0.64,0.5,0.36,0.22,0.1,0.03] },
          "moments": {
            "firstToFall": { "cell": 0, "userId": "host", "atSeconds": 0 },
            "lastSquare": { "cell": 3, "userId": "mate", "atSeconds": 115 },
            "turningPoint": { "stallSeconds": 100, "breakSeconds": 110, "burst": 2 }
          }
        }
    """.trimIndent()

    val ABANDON_RESPONSE = """{ "gameId": "7d9f34a2-4b1e-4c3a-9d2f-8a6b5c4d3e2f", "status": "abandoned" }"""

    // POST /games/{id}/share: {shareUrl, token} (§12; SHARE.md). The token matches the pinned
    // base64url 43-char shape; shareUrl is {share-origin}/s/{token}.
    val SHARE_RESPONSE = """
        { "shareUrl": "https://crossy.ing/s/aB3dEf7GhIjKlMnOpQrStUvWxYz012345678-_abcd", "token": "aB3dEf7GhIjKlMnOpQrStUvWxYz012345678-_abcd" }
    """.trimIndent()

    val KICK_RESPONSE = """{ "gameId": "7d9f34a2-4b1e-4c3a-9d2f-8a6b5c4d3e2f", "removed": "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e" }"""

    val DELETE_ACCOUNT_RESPONSE = """
        { "userId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", "tombstoned": true, "successions": 1, "abandoned": ["c3d4e5f6-a7b8-4c9d-8e0f-2a3b4c5d6e7f"], "vendorDeleted": true }
    """.trimIndent()

    val PUZZLE_VIEW = """
        {
          "puzzleId": "3f8c2b1a-9e4d-4f6a-b7c8-2d1e0f9a8b7c",
          "puzzle": { "rows": 1, "cols": 2, "blocks": [1], "circles": [], "clues": { "across": [ { "number": 1, "text": "Feline pet", "cellIndices": [0] } ], "down": [] } }
        }
    """.trimIndent()

    val ERROR_ENVELOPE_VALIDATION = """{ "error": "VALIDATION", "message": "before must be an ISO 8601 timestamp" }"""
}
