// Arrival copy (EXPERIENCE.md §5, ID-5): plain and warm, controls that say what
// happens, errors that say what went wrong and what to do, without apology. Lexicon
// sentences are verbatim contract; everything else here follows their voice. Errors
// key on the stable §12 code STRING (PROTOCOL.md §12), one human sentence per code:
// CrossyUI does not import CrossyProtocol (AD-2), and the codes are strings on the
// wire anyway, so the composition root passes the code through and the raw string
// never reaches the screen.

/// A failed arrival call as the screens consume it: the stable code when the server
/// spoke, nil when the network never answered. The sentence derives from the code
/// alone, never from server prose.
public struct ArrivalFailure: Error, Equatable, Sendable {
    /// The §12 code string (`GAME_NOT_FOUND`, `DENIED`, ...), or nil for network
    /// weather (nothing was judged).
    public let code: String?

    public init(code: String?) {
        self.code = code
    }

    /// Network weather: no server verdict, retrying can help.
    public static let offline = ArrivalFailure(code: nil)

    public var sentence: String { ArrivalCopy.sentence(forCode: code) }

    /// DENIED is honest and final (EXPERIENCE.md §3 Join): the denylist does not
    /// change on retry, so the join screen stops inviting one.
    public var isFinal: Bool { code == "DENIED" }
}

/// The legal page a footer button asks for. Screens signal this intent through
/// `onOpenLegal` and never hold URLs (AD-2); the composition root maps it to the
/// web origin's live page and presents an in-app Safari sheet.
public enum LegalPage: Sendable, Equatable {
    case privacy
    case terms
}

public enum ArrivalCopy {
    // MARK: - Welcome (EXPERIENCE.md §3: wordmark, one line, one button)

    /// The one line that says what this is.
    public static let welcomeLine = "Crosswords you solve together."
    public static let continueWithApple = "Continue with Apple"
    public static let continueWithDiscord = "Continue with Discord"
    /// The two secondary methods (roadmap I3b), worded like the primary buttons.
    public static let continueWithHisbaan = "Continue with Hisbaan"
    public static let continueWithEmail = "Continue with email"

    // MARK: - "Continue another way" sheet (roadmap I3b)

    /// The quiet tertiary affordance under the two primary buttons: it opens the sheet
    /// that holds the secondary methods. Subordinate by design, so it reads as an
    /// escape hatch, not a third first-class button.
    public static let continueAnotherWay = "Continue another way"
    /// The sheet's own title, and the two rows it lists.
    public static let continueSheetTitle = "Another way in"
    public static let continueRowEmail = "Email"
    public static let continueRowHisbaan = "Hisbaan"
    /// The email step: the field's prompt, the one line under it, and the send action.
    public static let emailEntryTitle = "Sign in with email"
    public static let emailFieldPrompt = "you@example.com"
    public static let emailEntryHint = "We'll send a six-digit code to your inbox."
    public static let emailSendCode = "Send code"
    /// The code step: the title names the address the code went to, the field prompt,
    /// the verify action, and the resend affordance (with its counting-down twin).
    public static let codeEntryTitle = "Enter the code"
    public static func codeEntryHint(email: String) -> String {
        "We sent a code to \(email). Enter it to sign in."
    }
    public static let codeFieldPrompt = "000000"
    public static let codeVerify = "Verify"
    public static let codeResend = "Resend code"
    public static func codeResendCountdown(seconds: Int) -> String {
        "Resend code in \(seconds)s"
    }
    /// Calm error copy for the two steps (same voice as the arrival errors: say what
    /// happened, offer the retry, no apology). The send and verify failures read as
    /// plain sentences; the server prose never reaches the screen.
    public static let emailSendFailed = "Couldn't send the code. Check the address and try again."
    public static let codeVerifyFailed = "That code didn't work. Check it and try again, or resend."
    /// Auth failure returns here with a plain retry, never a dead end.
    public static let signInFailed = "Sign-in didn't finish. Try again."
    /// The honest unconfigured state: the plist slots are empty in this build.
    public static let signInUnconfigured = "This build isn't set up for sign-in yet."
    /// The quiet legal pair shown before sign-in and again inside Settings; each
    /// opens its live page (/privacy, /terms) in an in-app Safari sheet.
    public static let privacyPolicy = "Privacy"
    public static let termsOfService = "Terms"

    // MARK: - Rooms (lexicon: home is Rooms)

    public static let roomsTitle = "Rooms"
    /// The empty state is an invitation, not a void: one line, then the standing
    /// actions carry the rest.
    public static let roomsEmpty = "No rooms yet. Join a friend's room with a code."
    /// The quiet caps label over the trailing shelf that gathers finished rooms, so the
    /// live rooms stay current up top (the web's grammar, Home.tsx). The same word the web
    /// shelf uses. Rendered only when at least one room is solved.
    public static let roomsSolvedSection = "Solved"

    // MARK: - Join (the top affordance and its camera-first panel)

    /// The top-trailing capsule on Rooms: one word, the glyph carries the how.
    public static let joinAffordance = "Join"
    /// The panel title: a room is what you join, however the code arrives.
    public static let joinTitle = "Join a room"
    /// Under the viewport, before the field: the typed path is always standing.
    public static let joinTypeInstead = "or type the code"
    /// The camera refused or absent: one plain sentence in the viewport, the field
    /// still beneath it (never a dead end).
    public static let joinScanDenied =
        "The camera's off for Crossy. Type the code, or turn it on in Settings."
    public static let joinAction = "Join"

    // MARK: - Puzzles (the library tab: what you've uploaded, browse-only until the
    // create-flow slice)

    public static let puzzlesTitle = "Puzzles"
    /// The empty state names the one place uploads happen today; the tab never
    /// pretends to an upload flow it doesn't have.
    public static let puzzlesEmpty = "No puzzles yet. Upload one on the web and it shows up here."
    /// The one action on a puzzle card: start a fresh game from that upload (the
    /// replay-without-reupload path the empty state points at). The web gallery uses
    /// the same words.
    public static let puzzleStartGame = "New game"
    /// The card's in-flight label while `POST /games` is out, the web's "Starting..."
    /// with the same voice.
    public static let puzzleStarting = "Starting"
    /// A failed start stays on the list and lets the card recover (a toast would be
    /// noise); the one line reads inline, keyed on the §12 code.
    public static func puzzleStartFailure(forCode code: String?) -> String {
        switch code {
        case nil:
            return "Couldn't reach Crossy to start the game. Try again."
        case "FULL_ACCOUNT_REQUIRED":
            return "Starting a game needs a signed-in account."
        case "UNAUTHORIZED":
            return "Your sign-in expired. Sign in again, then start the game."
        case "PUZZLE_NOT_FOUND":
            return "That puzzle is no longer available."
        default:
            return "Couldn't start the game. Try again."
        }
    }

    // MARK: - Settings (roadmap I3: thin v1, three things and a quiet footer)

    /// The screen title, and the tab's label (the signed-in shell's three tabs are
    /// the three place names: Rooms, Puzzles, Settings).
    public static let settingsTitle = "Settings"
    /// The name shown when auth state holds none (display name is not persisted yet;
    /// the puck and provider still identify the person).
    public static let settingsNoName = "Signed in"
    public static let signOutAction = "Sign out"
    public static let deleteAccountAction = "Delete account"

    // Solving preferences (personal-settings slice 1): the two per-device navigation
    // knobs, worded the way the web twin words them so both surfaces read the same.
    /// The quiet caps header over the solving-preferences block (the web's word).
    public static let settingsSolvingSection = "Solving"
    /// The skip-filled toggle and its one-line subtitle.
    public static let settingsSkipFilledTitle = "Skip filled squares"
    public static let settingsSkipFilledSubtitle = "While typing within a word"
    /// The end-of-word picker, its one-line subtitle, and its two option labels. The
    /// option labels are the short web twins ("Next clue" / "First blank"), so the menu's
    /// collapsed value stays a compact word rather than a whole sentence.
    public static let settingsEndOfWordTitle = "At the end of a word"
    public static let settingsEndOfWordSubtitle = "Once the word is full"
    public static let settingsEndOfWordNextClue = "Next clue"
    public static let settingsEndOfWordFirstBlank = "First blank"
    /// The provider line beneath the name, or the fallback when none is remembered.
    public static let providerDiscord = "Discord"
    public static let providerApple = "Apple"
    /// The two secondary sign-in methods (roadmap I3b): the custom OIDC provider and email
    /// OTP / magic link. The Account screen names them the same way it names the others.
    public static let providerHisbaan = "Hisbaan"
    public static let providerEmail = "Email"
    public static let providerUnknown = "Signed in"

    /// The two-beat confirmation body (roadmap I3): the consequence stated plainly, so
    /// the destructive action is never a surprise. Identity removed; hosted games handed
    /// on or ended; past contributions remain as an anonymous former participant.
    public static let deleteAccountConfirmTitle = "Delete your account?"
    public static let deleteAccountConfirmBody =
        "Your account is removed. Games you host pass to another solver, or end if you "
        + "are the last one. Your past answers stay in those rooms, credited to a former "
        + "participant with no name."
    /// The destructive button in the dialog.
    public static let deleteAccountConfirmAction = "Delete account"
    public static let deleteAccountCancelAction = "Keep my account"

    /// The inline delete-failure sentence, keyed on the stable §12 code (same voice as
    /// the arrival errors: say what happened, offer the retry, no apology).
    public static func deleteFailure(forCode code: String?) -> String {
        switch code {
        case nil:
            return "Couldn't reach Crossy to delete your account. Try again."
        case "UNAUTHORIZED":
            return "Your sign-in expired. Sign in again, then delete your account."
        default:
            return "Couldn't delete your account. Try again."
        }
    }

    // MARK: - Errors, keyed on stable codes only (PROTOCOL.md §12)

    /// One human sentence per §12 code. An unknown code (the vocabulary grows, §12
    /// says so) degrades to the plain fallback; the raw code never renders.
    public static func sentence(forCode code: String?) -> String {
        switch code {
        case nil:
            return "Couldn't reach Crossy. Check your connection and try again."
        case "GAME_NOT_FOUND":
            // Lexicon verbatim: join failure.
            return "That code doesn't match any room."
        case "DENIED":
            // Lexicon verbatim: kicked; on a join the denylist is the only cause.
            return "The host removed you from this room."
        case "UNAUTHORIZED":
            return "Your sign-in expired. Sign in again."
        case "FULL_ACCOUNT_REQUIRED":
            return "This needs a signed-in account."
        case "VALIDATION":
            return "That isn't a code Crossy recognizes."
        default:
            return "Something went wrong. Try again."
        }
    }
}
