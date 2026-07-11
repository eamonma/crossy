// Join a room (EXPERIENCE.md §3): camera-first, code always standing. The viewport
// scans an invite QR — the projector's share link, the §12 unfurl link, or a bare
// code, all digested by InviteScan — and a hit fills the field and submits, so the
// scan is legible as the same act as typing. Beneath it the one field keeps the
// read-aloud alphabet honest through InviteCodeEntry (uppercase as typed,
// alphabet-only, eight characters); failures arrive keyed on the stable code and
// render as one sentence (ArrivalCopy). DENIED is honest and final: the sentence
// stands and the same code cannot be resubmitted, scanned or typed.
//
// AD-2: the camera and its permission live in the app target. This screen takes a
// verdict (JoinScanState) and a scanner view builder, and renders the chrome: the
// viewport, the quiet denied sentence, the typed path. Success is the parent's
// navigation (a full account lands in the room as a solver, owner decision
// 2026-07-10); this screen only reports the attempt.
//
// The screen rides a glass sheet that flows out of the Join capsule (arrival
// notes, DESIGN.md §4). Camera-first amends the keyboard law's application: the
// field no longer autofocuses on appear (the keyboard would bury the viewport);
// it focuses on tap, and the viewport folds away on the chrome spring while the
// keyboard rises, unfolding when focus leaves. The scanner stays mounted through
// the fold (height zero, clipped), so the camera session never tears down and
// refocusing is instant. In the .none composition (macOS host, previews) the
// screen is the one-field card exactly as before, autofocus included.

import CrossyDesign
import SwiftUI

/// The sheet the screen presents in (arrival notes, DESIGN.md §4), named so the
/// composition root and the tests share pinnable values.
public enum JoinSheetPresentation {
    /// The one-field card (the .none composition): title, field, failure line,
    /// button, with room for the keyboard, nothing more.
    public static let detentFraction: CGFloat = 0.42
    /// The camera-first panel: viewport plus the typed path beneath.
    public static let scanDetentFraction: CGFloat = 0.72
    /// The viewport's standing height; it folds to zero while the field is
    /// focused so the keyboard never buries a live camera.
    public static let viewportHeight: CGFloat = 300
}

/// How scanning stands on this composition (AD-2: the camera and its permission
/// are the app target's; the screen renders the verdict).
public enum JoinScanState: Equatable, Sendable {
    /// No scanning here (macOS host, previews): the one-field card.
    case none
    /// Permission resolving: the viewport holds its quiet dark ground.
    case probing
    /// The injected scanner is live in the viewport.
    case live
    /// Camera refused or absent: one plain sentence, the field still beneath.
    case denied
}

public struct JoinCodeScreen<Scanner: View>: View {
    private let scanState: JoinScanState
    /// Attempt the join; nil means success (the parent navigates away).
    private let onJoin: (String) async -> ArrivalFailure?
    /// The live camera view, built around this screen's ingest so a scanned
    /// payload takes exactly the typed path.
    private let scanner: (@escaping (String) -> Void) -> Scanner

    @Environment(\.colorScheme) private var colorScheme
    @State private var code = ""
    @State private var submitting = false
    @State private var failure: ArrivalFailure?
    /// The code a final failure judged; resubmitting it is refusing to hear.
    @State private var deadCode: String?
    /// The last code a scan attempted: one attempt per scanned code, so a QR
    /// lingering in front of the lens never hammers the API with a retry loop.
    @State private var scannedAttempt: String?
    @FocusState private var fieldFocused: Bool

    public init(
        scanState: JoinScanState,
        onJoin: @escaping (String) async -> ArrivalFailure?,
        @ViewBuilder scanner: @escaping (@escaping (String) -> Void) -> Scanner
    ) {
        self.scanState = scanState
        self.onJoin = onJoin
        self.scanner = scanner
    }

    private var ground: GridGround {
        colorScheme == .dark ? .observatory : .studio
    }

    private var canSubmit: Bool {
        InviteCodeEntry.isComplete(code) && !submitting && code != deadCode
    }

    /// The viewport folds while typing; it renders at all only when this
    /// composition scans.
    private var viewportFolded: Bool { fieldFocused }

    public var body: some View {
        VStack(spacing: 0) {
            Text(verbatim: ArrivalCopy.joinTitle)
                .font(.system(size: 24, weight: .bold))
                .foregroundStyle(Color(rgb: ground.tokens.ink))
                .padding(.top, scanState == .none ? 48 : 30)

            if scanState != .none {
                viewport
                    .padding(.horizontal, 24)
                    .padding(.top, 20)

                Text(verbatim: ArrivalCopy.joinTypeInstead)
                    .font(.system(size: 14))
                    .foregroundStyle(Color(rgb: ground.tokens.number))
                    .frame(height: viewportFolded ? 0 : 20)
                    .opacity(viewportFolded ? 0 : 1)
                    .clipped()
                    .padding(.top, viewportFolded ? 0 : 16)
            }

            field
                .padding(.horizontal, 24)
                .padding(.top, scanState == .none ? 24 : 16)

            if let failure {
                Text(verbatim: failure.sentence)
                    .font(.system(size: 14))
                    .foregroundStyle(Color(rgb: ground.tokens.number))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
                    .padding(.top, 16)
            }

            joinButton
                .padding(.horizontal, 24)
                .padding(.top, failure == nil ? 20 : 16)

            Spacer(minLength: 0)
        }
        .animation(.crossyChrome, value: viewportFolded)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(rgb: ground.tokens.canvas).ignoresSafeArea())
        // A scan lock is felt before it is seen: the code lands in the field and
        // the join fires in the same beat.
        .sensoryFeedback(.impact(weight: .medium), trigger: scannedAttempt)
        // Focus WITH the presentation only on the one-field card (the keyboard is
        // part of that sheet's rise, owner device report 2026-07-10). Camera-first
        // inverts it: the viewport is the rise, and the keyboard comes when the
        // field is asked for. The task still cancels with the sheet.
        .task {
            if scanState == .none {
                fieldFocused = true
            }
        }
    }

    /// The camera window: a dark pane on either ground (a viewport reads as a
    /// window, not paper), the live scanner filling it edge to edge, or the one
    /// quiet denied sentence. Folds to zero height while the field is focused —
    /// mounted throughout, so the session survives the fold.
    private var viewport: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(Color(rgb: GridGround.observatory.tokens.canvas))

            switch scanState {
            case .live:
                scanner(ingest)
            case .denied:
                Text(verbatim: ArrivalCopy.joinScanDenied)
                    .font(.system(size: 14))
                    .foregroundStyle(Color(rgb: GridGround.observatory.tokens.number))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            case .probing, .none:
                EmptyView()
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: viewportFolded ? 0 : JoinSheetPresentation.viewportHeight)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .strokeBorder(Color(rgb: ground.tokens.gridLine), lineWidth: 1))
    }

    /// A scanned payload takes the typed path exactly: digest, fill the field,
    /// submit. One attempt per scanned code; a dead code stays dead (DENIED).
    private func ingest(_ payload: String) {
        guard !submitting else { return }
        guard let scanned = InviteScan.code(fromPayload: payload) else { return }
        guard scanned != scannedAttempt, scanned != deadCode else { return }
        scannedAttempt = scanned
        code = scanned
        Task { await submit() }
    }

    /// The one field: a paper cell row, tabular glyphs (TypeScale: invite codes
    /// never jitter in width), the system keyboard (this is chrome-level text
    /// entry, not the board; the key deck's never-the-system-keyboard rule is the
    /// solve screen's, EXPERIENCE.md §3).
    private var field: some View {
        TextField(
            "",
            text: $code,
            // Eight quiet slots, so the resting field reads as what it wants
            // (the camera-first panel no longer autofocuses, so the field is
            // seen empty; a real-looking example code would invite typing it).
            prompt: Text(verbatim: String(repeating: "\u{00B7}", count: InviteCodeEntry.length))
                .foregroundStyle(Color(rgb: ground.tokens.number).opacity(0.5))
        )
        .font(.system(size: 28, weight: .semibold, design: .monospaced))
            .foregroundStyle(Color(rgb: ground.tokens.ink))
            .multilineTextAlignment(.center)
            .focused($fieldFocused)
            .autocorrectionDisabled()
            #if os(iOS)
                .textInputAutocapitalization(.characters)
                .keyboardType(.asciiCapable)
            #endif
            .onChange(of: code) { _, raw in
                let cleaned = InviteCodeEntry.sanitize(raw)
                if cleaned != raw { code = cleaned }
                if failure != nil, code != deadCode { failure = nil }
            }
            .frame(height: 64)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color(rgb: ground.tokens.cell))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(Color(rgb: ground.tokens.gridLine), lineWidth: 1))
            )
    }

    private var joinButton: some View {
        Button {
            Task { await submit() }
        } label: {
            ZStack {
                Text(verbatim: ArrivalCopy.joinAction)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(
                        Color(rgb: ground.tokens.ink).opacity(canSubmit ? 1 : 0.4)
                    )
                    .opacity(submitting ? 0 : 1)
                if submitting {
                    ProgressView()
                        .tint(Color(rgb: ground.tokens.ink))
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: ChromeLayout.barHeight)
            // The whole capsule takes the tap (the WelcomeScreen finding).
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .modifier(ChromeGlassSurface(cornerRadius: ChromeLayout.barCornerRadius))
        .disabled(!canSubmit)
    }

    private func submit() async {
        guard canSubmit else { return }
        submitting = true
        defer { submitting = false }
        let attempted = code
        let outcome = await onJoin(attempted)
        failure = outcome
        if outcome?.isFinal == true {
            deadCode = attempted
        }
    }
}

extension JoinCodeScreen where Scanner == EmptyView {
    /// The one-field card, no scanning (macOS host, previews): the original
    /// composition, autofocus included.
    public init(onJoin: @escaping (String) async -> ArrivalFailure?) {
        self.init(scanState: .none, onJoin: onJoin) { _ in EmptyView() }
    }
}

#Preview("Join, one-field card, Studio") {
    JoinCodeScreen(onJoin: { _ in ArrivalFailure(code: "GAME_NOT_FOUND") })
}

#Preview("Join, camera denied, Observatory") {
    JoinCodeScreen(scanState: .denied, onJoin: { _ in nil }) { _ in EmptyView() }
        .preferredColorScheme(.dark)
}
