# Crossy v2 — Behavioral Specification

A real-time collaborative crossword-solving web application.

---

## 1. Overview

Crossy is a multiplayer crossword puzzle application that allows users to solve puzzles together in real-time. Players can import puzzles, create games, invite friends via shareable links, and collaboratively fill in answers while seeing each other's cursor positions live.

**Tech Stack:**
- Next.js 14 (App Router)
- Supabase (PostgreSQL, Auth, Realtime)
- Tailwind CSS + Radix UI
- Vercel hosting with Sentry monitoring

---

## 2. User Flows

### 2.1 Authentication

| Scenario | Behavior |
|----------|----------|
| Unauthenticated user visits `/` | Shows landing page with "Solve crosswords together" hero and login button |
| User clicks login | Redirected to `/login` with OAuth provider options |
| OAuth providers available | Microsoft (Azure), Apple, Discord, GitHub |
| Dev mode only | Email/password login form appears |
| Successful OAuth | Redirect to `/auth/callback` → session created → redirect to `/play` |
| Session expires | Middleware redirects to `/login` |
| Session refresh | Automatic via Supabase cookies on each request |

### 2.2 Puzzle Management

| Action | Behavior |
|--------|----------|
| View puzzles | Navigate to `/play/puzzles` to see all puzzles |
| Create puzzle via file | Click create → upload `.json` file → validates schema → stores puzzle |
| Create puzzle via URL | Click create → paste URL → fetches and validates → stores puzzle |
| Use "latest" shorthand | Entering "latest" as URL fetches from `NEXT_PUBLIC_LATEST_URL` |
| Invalid puzzle format | Zod validation error displayed with specific field failures |
| View puzzle detail | Navigate to `/play/puzzles/[slug]` shows grid preview |

### 2.3 Game Creation & Sharing

| Action | Behavior |
|--------|----------|
| Start game from puzzle | Creates game instance with unique ID and random password |
| Creator automatically added | `game_user` association created for game creator |
| Generate share link | Format: `https://domain/play/games/{id}?key={password}` |
| Copy share link | Copies full URL with `https://` prefix preserved |
| Invitee opens link | If authenticated → validates password → adds to `game_user` → joins game |
| Invitee not authenticated | Redirected to `/login`, then returns to game link |
| Invalid password | Redirected away with error message |
| Join concluded game | Redirected with "game has concluded" error |

---

## 3. Game Board Behaviors

### 3.1 Grid Rendering

| Element | Specification |
|---------|---------------|
| Cell size | 36px × 36px |
| Grid type | SVG-based rendering |
| Black squares | Rendered with dark gray fill |
| Cell numbers | Top-left corner of numbered cells |
| Circles | Optional ring overlay for themed puzzles |
| Current cell highlight | Blue (dark mode) / Yellow (light mode) |
| Current word highlight | Violet/blue shading on all cells in active word |

### 3.2 Selection & Navigation

| Input | Behavior |
|-------|----------|
| Click cell | Selects cell, sets direction based on context |
| Click same cell again | Toggles between Across and Down direction |
| Arrow keys | Move within current direction |
| Tab | Jump to next word (first empty cell, or word start if complete) |
| Shift+Tab | Jump to previous word |
| Enter | Move to next clue |

### 3.3 Text Input

| Input | Behavior |
|-------|----------|
| A-Z, 0-9 | Enters character in current cell, advances to next cell |
| Backspace on non-empty cell | Clears current cell |
| Backspace on empty cell | Moves to previous cell AND clears it |
| Delete | Clears current cell without moving |
| Case handling | Input normalized, comparison case-insensitive |

### 3.4 Mobile-Specific

| Feature | Behavior |
|---------|----------|
| On-screen keyboard | Displayed using react-simple-keyboard |
| Swipe gestures | Replace arrow key navigation |
| Swipe same direction as solving | Move to next/previous word |
| Swipe perpendicular direction | Toggle between Across/Down |
| Scroll prevention | Touch events captured to prevent page scroll during gameplay |

---

## 4. Real-Time Collaboration

### 4.1 Presence System

| Event | Behavior |
|-------|----------|
| User joins game | Added to presence channel, avatar appears in online users list |
| User leaves game | Removed from presence channel after disconnect |
| SYNC event | Initial population of all online users |
| JOIN event | Add single user to online list |
| LEAVE event | Remove single user from online list |

### 4.2 Position Broadcasting

| Event | Behavior |
|-------|----------|
| User moves cursor | Broadcasts `{user_id, currentCell, currentDirection}` |
| Receive position update | Shows friend avatar at their cell position |
| Direction indicator | Arrow pointing left (Across) or down (Down) |
| Multiple users same cell | Shows count badge instead of stacked avatars |

### 4.3 Grid Synchronization

| Event | Behavior |
|-------|----------|
| Local answer change | Optimistic UI update immediately |
| Debounce window | 200ms before sending to server |
| Server update | RPC call to `update_grid_element(game_id, grid_index, new_value)` |
| Remote change received | Applied to local state if remote is "ahead" |
| Conflict resolution | Uses `anticipated` counter for acknowledgment tracking |
| Network failure | Local state preserved, retry on reconnect |

---

## 5. Game Completion

### 5.1 Detection

| Check | Specification |
|-------|---------------|
| Trigger | After every keystroke |
| Condition | All non-black cells filled with correct character |
| Comparison | First character of each cell, case-insensitive |
| Status requirement | Game must be in "ongoing" status |

### 5.2 Completion Flow

1. Client detects all answers correct
2. POST to `/api/games/claim-complete` with `gameId`
3. Server verifies:
   - Game exists
   - Status is "ongoing"
   - All answers match puzzle grid
4. Server updates `status_of_game` to "completed" with timestamp
5. Real-time subscription notifies all clients
6. Confetti animation plays (5 seconds)
7. Congratulations modal appears

### 5.3 Post-Completion

| Behavior | Specification |
|----------|---------------|
| Modal dismissal | Cannot close until status confirmed != "ongoing" |
| Game access | Read-only, no further edits |
| Rejoin attempt | Shows completed state |

---

## 6. Game States

| Status | Description |
|--------|-------------|
| `ongoing` | Active game, accepting input |
| `completed` | Puzzle solved successfully |
| `abandoned` | Game discontinued (manual action) |

State stored in `status_of_game` table with 1:1 relationship to `games`.

---

## 7. Data Models

### 7.1 Puzzle Schema (Import Format)

```json
{
  "title": "String - puzzle name",
  "grid": ["A", "B", "C", ...],
  "gridnums": [1, 0, 2, ...],
  "circles": [0, 0, 1, ...],
  "size": { "cols": 15, "rows": 15 },
  "clues": {
    "across": ["1. First clue", "5. Second clue", ...],
    "down": ["1. Down clue", "2. Another clue", ...]
  },
  "answers": {
    "across": ["ANSWER", "REPLY", ...],
    "down": ["ALPHA", "BETA", ...]
  }
}
```

### 7.2 Database Tables

**profiles**
- `id` (UUID, FK to auth.users)
- `full_name`, `username`, `avatar_url`
- `updated_at`

**puzzles**
- `id` (UUID)
- `name` (text)
- `grid` (text[] — single characters)
- `gridnums` (int[])
- `circles` (boolean[] — optional)
- `clues` (JSON — `{across: [], down: []}`)
- `answers` (JSON — `{across: [], down: []}`)
- `cols`, `rows` (int)
- `created_by` (UUID), `created_at`

**games**
- `id` (UUID)
- `puzzle_id` (UUID, FK)
- `created_by` (UUID, nullable)
- `grid` (text[] — current user answers)
- `password` (text — for sharing)
- `created_at`, `updated_at`

**game_user**
- `game_id`, `user_id` (composite key)
- `n_actions` (int)
- `created_at`

**status_of_game**
- `id` (UUID, FK to games, 1:1)
- `status` (enum: ongoing/completed/abandoned)
- `game_ended_at` (timestamp, null until ended)

---

## 8. API Endpoints

### POST `/api/puzzles`
Create a new puzzle.

**Request:** CrosswordJson object
**Response:** `{ data: { id, ...puzzle_data } }`
**Validation:** Zod schema with grid/gridnums/circles length checks

### POST `/api/games/claim-complete`
Mark game as completed.

**Request:** `gameId` (string as JSON body)
**Response:** `{ data: 'ok' }` or `{ error: message }`
**Side effects:** Updates status_of_game, sets game_ended_at

### POST `/api/games/get-share-link`
Generate shortened share link.

**Request:** `{ url: string }`
**Response:** `{ data: short_url }`
**Note:** Currently disabled, returns original URL

### GET `/api/og?game=[gameId]`
Generate OpenGraph image for social sharing.

### GET `/auth/callback`
OAuth code exchange, creates session, redirects to `/play`.

---

## 9. Real-Time Channels

### Presence Channel: `rooms-{gameId}`
- **Type:** PRESENCE
- **Events:** JOIN, SYNC, LEAVE
- **Payload:** `{ user_id: string }`
- **Purpose:** Track online players

### Broadcast Channel: `position-{gameId}`
- **Type:** BROADCAST
- **Event:** `POS`
- **Payload:** `{ user_id, currentCell, currentDirection }`
- **Purpose:** Show friend cursor positions

### Postgres Changes: `table-db-changes`
- **Tables:** `games`, `status_of_game`
- **Filter:** `game_id=eq.{gameId}`
- **Events:** INSERT, UPDATE, DELETE
- **Purpose:** Grid sync, status updates

---

## 10. Configuration

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side elevated access |
| `NEXT_PUBLIC_LIVE_DOMAIN` | Domain for share links |
| `NEXT_PUBLIC_IMAGE_HOST` | CDN host for clue images |
| `NEXT_PUBLIC_LATEST_URL` | Default URL for "latest" shorthand |
| `YOURLS_API_KEY` | URL shortening (currently disabled) |

### Hardcoded Values

| Setting | Value |
|---------|-------|
| Cell size | 36px |
| Debounce timing | 200ms |
| Confetti duration | 5 seconds |
| Timer update frequency | 1 second |
| LRU cache size | 500 items |

---

## 11. Timer Display Format

| Duration | Format |
|----------|--------|
| < 1 day | `HH:MM:SS` |
| 1+ days | `Xd HH:MM:SS` |
| 1+ weeks | `Xw Xd` |
| 1+ years | `Xy Xw` |

---

## 12. Error Handling

### Client-Side
- Network errors: Graceful fallback (e.g., show original URL if shortening fails)
- Validation errors: Zod messages displayed to user
- Permission denied: Redirect to `/login`
- Offline state: Notice component shown, local state preserved

### Server-Side
- JSON error responses: `{ error: message }`
- Database errors: Logged, user-friendly message returned
- RPC failures: Error field checked in response
- Sentry integration for error tracking

---

## 13. Edge Cases

### Smart Backspace
- Empty cell + backspace = move back AND clear previous
- Prevents awkward "stuck" navigation

### Word Completion Navigation
- Tab skips to first empty cell in next word
- If entire word filled, jumps to word boundary
- Shift+Tab reverses direction

### Answer Sync Conflicts
- Local changes tracked with `anticipated` counter
- Remote updates only applied when counter = 0
- Prevents local work from being overwritten

### Puzzle Images in Clues
- HTML parsed from clue text
- Image URLs prefixed with `NEXT_PUBLIC_IMAGE_HOST`
- Supports inline images in clue descriptions

### Multiple Users at Same Cell
- Instead of stacking avatars, shows count badge
- Tooltip reveals all users at position

---

## 14. Security

### Authorization
- `user_has_game_access()` RPC verifies game membership
- Password validation for invitations
- Service role client used server-side for privileged operations

### Data Access
- Row-level security on Supabase tables
- User can only see games they're part of (`user_related_games` view)
- Puzzles visible based on creator or game membership

### Session Management
- Supabase SSR handles cookie-based sessions
- Automatic refresh via middleware
- Secure OAuth flow with PKCE

---

## 15. File Structure Reference

```
crossy-web/
├── app/
│   ├── (landing)/           # Unauthenticated routes
│   │   ├── page.tsx         # Landing hero
│   │   ├── login/           # Auth flow
│   │   └── privacy/, terms/ # Legal
│   ├── (app)/play/          # Authenticated routes
│   │   ├── games/[slug]/    # Game board
│   │   ├── puzzles/         # Puzzle management
│   │   └── profile/         # User settings
│   └── api/                 # API routes
├── components/              # Shared UI
├── lib/                     # Types, schemas, utilities
├── utils/supabase/          # Client initialization
└── supabase/migrations/     # Database schema
```

---

## 16. Key Implementation Files

| File | Purpose |
|------|---------|
| `app/(app)/play/games/[slug]/gameboard.tsx` | Main game interaction (586 lines) |
| `app/(app)/play/games/[slug]/gameLayout.tsx` | Game orchestration |
| `app/(app)/play/games/[slug]/useRealtimeCrossword.tsx` | Real-time sync hook |
| `lib/crosswordJson.ts` | Puzzle validation schema |
| `lib/database.types.ts` | Generated Supabase types |
| `app/api/games/claim-complete/route.ts` | Completion verification |
| `utils/supabase/server.ts` | Server client setup |
