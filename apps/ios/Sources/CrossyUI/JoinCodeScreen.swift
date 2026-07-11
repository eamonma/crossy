// Join with a code (EXPERIENCE.md §3): one field, the read-aloud alphabet,
// autocapitalized, ambiguity-free. The field keeps itself honest through
// InviteCodeEntry (uppercase as typed, alphabet-only, eight characters); failures
// arrive keyed on the stable code and render as one sentence (ArrivalCopy). DENIED
// is honest and final: the sentence stands and the same code cannot be resubmitted.
// Success is the parent's navigation (a full account lands in the room as a solver,
// owner decision 2026-07-10); this screen only reports the attempt.

import CrossyDesign
import SwiftUI

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
        .onAppear { fieldFocused = true }
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
