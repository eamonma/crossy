// Join with a code (EXPERIENCE.md §3): one field, the read-aloud alphabet,
// autocapitalized, ambiguity-free. The field keeps itself honest through
// InviteCodeEntry (uppercase as typed, alphabet-only, eight characters); failures
// arrive keyed on the stable code and render as one sentence (ArrivalCopy). DENIED
// is honest and final: the sentence stands and the same code cannot be resubmitted.
// Success is the parent's navigation (a full account lands in the room as a solver,
// owner decision 2026-07-10); this screen only reports the attempt.
//
// The screen rides a glass sheet that flows out of the Rooms button (arrival notes,
// DESIGN.md §4). Focus is deferred until the sheet settles: raising the keyboard in
// onAppear raced the presentation and jolted (owner device report 2026-07-10), so
// the field asks for focus one presentation-length later (JoinSheetPresentation).

import CrossyDesign
import SwiftUI

/// The sheet the screen presents in (arrival notes, DESIGN.md §4): a card detent,
/// named so the composition root and the tests share one pinnable value.
public enum JoinSheetPresentation {
    /// The detent the sheet claims: title, one field, the failure line, and the
    /// button, with room for the keyboard, nothing more. A fraction of the height
    /// so it reads as a card grown from the button, not a full page. The
    /// composition root sizes the sheet with this.
    public static let detentFraction: CGFloat = 0.42
}

public struct JoinCodeScreen: View {
    /// Attempt the join; nil means success (the parent navigates away).
    private let onJoin: (String) async -> ArrivalFailure?

    @Environment(\.colorScheme) private var colorScheme
    @State private var code = ""
    @State private var submitting = false
    @State private var failure: ArrivalFailure?
    /// The code a final failure judged; resubmitting it is refusing to hear.
    @State private var deadCode: String?
    @FocusState private var fieldFocused: Bool

    public init(onJoin: @escaping (String) async -> ArrivalFailure?) {
        self.onJoin = onJoin
    }

    private var ground: GridGround {
        colorScheme == .dark ? .observatory : .studio
    }

    private var canSubmit: Bool {
        InviteCodeEntry.isComplete(code) && !submitting && code != deadCode
    }

    public var body: some View {
        VStack(spacing: 24) {
            Text(verbatim: ArrivalCopy.joinWithCode)
                .font(.system(size: 24, weight: .bold))
                .foregroundStyle(Color(rgb: ground.tokens.ink))
                .padding(.top, 48)

            field
                .padding(.horizontal, 24)

            if let failure {
                Text(verbatim: failure.sentence)
                    .font(.system(size: 14))
                    .foregroundStyle(Color(rgb: ground.tokens.number))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }

            joinButton
                .padding(.horizontal, 24)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(rgb: ground.tokens.canvas).ignoresSafeArea())
        // Focus WITH the presentation, not after it: in a sheet the keyboard is
        // part of the rise, and the system lifts sheet and keyboard as one
        // motion from the bottom. Deferring focus split that in two, the sheet
        // settling at its detent and then jumping as keyboard avoidance shoved
        // the container up (owner device report 2026-07-10, the evening's
        // second finding; the deferral was solving the retired push's race).
        // The task still cancels with the sheet on a fast dismiss.
        .task {
            fieldFocused = true
        }
    }

    /// The one field: a paper cell row, tabular glyphs (TypeScale: invite codes
    /// never jitter in width), the system keyboard (this is chrome-level text
    /// entry, not the board; the key deck's never-the-system-keyboard rule is the
    /// solve screen's, EXPERIENCE.md §3).
    private var field: some View {
        TextField("", text: $code)
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

#Preview("Join, Studio") {
    JoinCodeScreen(onJoin: { _ in ArrivalFailure(code: "GAME_NOT_FOUND") })
}
