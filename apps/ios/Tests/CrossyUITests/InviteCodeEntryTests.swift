import XCTest

@testable import CrossyUI

// The invite-code field's honesty (EXPERIENCE.md §3 Join): the read-aloud alphabet
// mirrored from apps/api/src/games/invite-code.ts, entry uppercased ASCII-only
// (INV-1: bytewise, no locale folding), glyphs no code can contain dropped, eight
// characters and no more. The server still owns lookup normalization (PROTOCOL.md
// §12); this mirror only shapes the field.

final class InviteCodeEntryTests: XCTestCase {
    func test_theAlphabetMirrorsTheAPIGeneratorExactly() {
        // INVITE_ALPHABET, apps/api/src/games/invite-code.ts: 32 symbols, no
        // 0/1/I/O. A drift here is a build failure by string comparison.
        XCTAssertEqual(InviteCodeEntry.alphabet, "23456789ABCDEFGHJKLMNPQRSTUVWXYZ")
        XCTAssertEqual(InviteCodeEntry.alphabet.count, 32)
        XCTAssertEqual(InviteCodeEntry.length, 8)
        for ambiguous in ["0", "1", "I", "O"] {
            XCTAssertFalse(
                InviteCodeEntry.alphabet.contains(ambiguous),
                "\(ambiguous) is visually ambiguous and never in a code")
        }
    }

    func test_lowercaseEntryUppercasesBytewiseASCIIOnly_INV1() {
        XCTAssertEqual(InviteCodeEntry.sanitize("abcd2345"), "ABCD2345")
        // Non-ASCII letters never fold in (INV-1 forbids locale and Unicode case
        // mapping): a dotless i or a full-width A is dropped, not mapped.
        XCTAssertEqual(InviteCodeEntry.sanitize("\u{0131}ABC"), "ABC")
        XCTAssertEqual(InviteCodeEntry.sanitize("\u{FF21}BC"), "BC")
    }

    func test_glyphsOutsideTheAlphabetDropIncludingTheAmbiguousFour() {
        XCTAssertEqual(InviteCodeEntry.sanitize("A B-C_D."), "ABCD")
        XCTAssertEqual(InviteCodeEntry.sanitize("0O1IL"), "L", "only L is a real code glyph")
    }

    func test_entryCapsAtEightCharacters() {
        XCTAssertEqual(InviteCodeEntry.sanitize("ABCDEFGHJK"), "ABCDEFGH")
        XCTAssertEqual(InviteCodeEntry.sanitize("AB CD EF GH JK"), "ABCDEFGH")
    }

    func test_completenessIsExactlyEightAlphabetCharacters() {
        XCTAssertTrue(InviteCodeEntry.isComplete("ABCDEFGH"))
        XCTAssertTrue(InviteCodeEntry.isComplete("23456789"))
        XCTAssertFalse(InviteCodeEntry.isComplete("ABCDEFG"))
        XCTAssertFalse(InviteCodeEntry.isComplete("ABCDEFGHJ"))
        XCTAssertFalse(InviteCodeEntry.isComplete("ABCDEFG0"), "0 is not in the alphabet")
        XCTAssertFalse(InviteCodeEntry.isComplete("abcdefgh"), "completeness is post-sanitize")
    }
}
