// The cold open (EXPERIENCE.md §2 moment 1, §3 Welcome): no tour, no carousel. The
// wordmark types itself into a few cells, one line says what this is, one button
// continues with Discord. This slice's wordmark moment is a simple staggered
// appearance (an opacity walk, which is already the §7 reduced-motion form); the
// owner feel-tests and tunes it after. Auth failure returns here with a plain retry,
// and the unconfigured build states itself in one sentence, never a crash, never a
// dead end (the fixture path is how a keyless build still walks the journey).

import CrossyDesign
import SwiftUI

/// What the Welcome screen can be showing, plain data the composition root maps
/// from the auth session's phase.
public enum WelcomeState: Equatable, Sendable {
    /// Signed out, ready to continue.
    case ready
    /// The web sheet is up (or the exchange is in flight): the frame stays quiet.
    case authenticating
    /// The plain retry (EXPERIENCE.md §3): one sentence, the same button.
    case failed
    /// The config slots are empty in this build: one honest sentence.
    case unconfigured
}

public struct WelcomeScreen: View {
    private let state: WelcomeState
    private let onContinue: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    @State private var typedCells = 0

    public init(state: WelcomeState, onContinue: @escaping () -> Void) {
        self.state = state
        self.onContinue = onContinue
    }

    private var ground: GridGround {
        colorScheme == .dark ? .observatory : .studio
    }

    private static let wordmark = Array("CROSSY")
    /// The stagger: one cell every beat, the whole word in under a second.
    static func typeDelay(forCell index: Int) -> TimeInterval {
        0.12 * TimeInterval(index)
    }

    public var body: some View {
        VStack(spacing: 0) {
            Spacer()
            wordmarkCells
            Text(verbatim: ArrivalCopy.welcomeLine)
                .font(.system(size: 16))
                .foregroundStyle(Color(rgb: ground.tokens.number))
                .padding(.top, 20)
            Spacer()
            footer
                .padding(.horizontal, 24)
                .padding(.bottom, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(rgb: ground.tokens.canvas).ignoresSafeArea())
        .task {
            for index in 0...Self.wordmark.count {
                typedCells = index
                try? await Task.sleep(for: .seconds(0.12))
            }
        }
    }

    /// The wordmark as board cells: paper cells, ink glyphs, appearing one by one.
    /// Opacity only, so Reduce Motion needs no variant (DESIGN.md §7).
    private var wordmarkCells: some View {
        HStack(spacing: 3) {
            ForEach(0..<Self.wordmark.count, id: \.self) { index in
                ZStack {
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(Color(rgb: ground.tokens.cell))
                        .overlay(
                            RoundedRectangle(cornerRadius: 6, style: .continuous)
                                .strokeBorder(Color(rgb: ground.tokens.gridLine), lineWidth: 1))
                    Text(verbatim: String(Self.wordmark[index]))
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundStyle(Color(rgb: ground.tokens.ink))
                        .opacity(index < typedCells ? 1 : 0)
                        .animation(.easeOut(duration: 0.18), value: typedCells)
                }
                .frame(width: 44, height: 44)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Crossy")
    }

    @ViewBuilder
    private var footer: some View {
        VStack(spacing: 14) {
            if state == .failed {
                Text(verbatim: ArrivalCopy.signInFailed)
                    .font(.system(size: 14))
                    .foregroundStyle(Color(rgb: ground.tokens.number))
                    .multilineTextAlignment(.center)
            }
            if state == .unconfigured {
                Text(verbatim: ArrivalCopy.signInUnconfigured)
                    .font(.system(size: 14))
                    .foregroundStyle(Color(rgb: ground.tokens.number))
                    .multilineTextAlignment(.center)
            } else {
                continueButton
            }
        }
    }

    private var continueButton: some View {
        Button(action: onContinue) {
            ZStack {
                Text(verbatim: ArrivalCopy.continueWithDiscord)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color(rgb: ground.tokens.ink))
                    .opacity(state == .authenticating ? 0 : 1)
                if state == .authenticating {
                    ProgressView()
                        .tint(Color(rgb: ground.tokens.ink))
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: ChromeLayout.barHeight)
            // The whole capsule is the button (owner device finding 2026-07-10:
            // a plain-style label's transparent expanse does not hit-test, so
            // without this only the text took the tap).
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .modifier(ChromeGlassSurface(cornerRadius: ChromeLayout.barCornerRadius))
        .disabled(state == .authenticating)
    }
}

#Preview("Welcome, Studio") {
    WelcomeScreen(state: .ready, onContinue: {})
}

#Preview("Welcome, failed, Observatory") {
    WelcomeScreen(state: .failed, onContinue: {})
        .preferredColorScheme(.dark)
}
