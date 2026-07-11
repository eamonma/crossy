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

public enum ArrivalCopy {
    // MARK: - Welcome (EXPERIENCE.md §3: wordmark, one line, one button)

    /// The one line that says what this is.
    public static let welcomeLine = "Crosswords you solve together."
    public static let continueWithApple = "Continue with Apple"
    public static let continueWithDiscord = "Continue with Discord"
    /// Auth failure returns here with a plain retry, never a dead end.
    public static let signInFailed = "Sign-in didn't finish. Try again."
    /// The honest unconfigured state: the plist slots are empty in this build.
    public static let signInUnconfigured = "This build isn't set up for sign-in yet."

    // MARK: - Rooms (lexicon: home is Rooms)

    public static let roomsTitle = "Rooms"
    public static let joinWithCode = "Join with a code"
    /// The empty state is an invitation, not a void: one line, then the standing
    /// actions carry the rest.
    public static let roomsEmpty = "No rooms yet. Join a friend's room with a code."

    // MARK: - Join with a code

    public static let joinAction = "Join"

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
