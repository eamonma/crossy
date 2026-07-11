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
    /// Which provider button the person tapped, so the spinner shows on that one alone
    /// while both disable (the other button was not the one that started the sheet).
    private enum Provider {
        case apple
        case discord
    }

    private let state: WelcomeState
    private let onContinueApple: () -> Void
    private let onContinueDiscord: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    @State private var typedCells = 0
    /// The button that fired; reset when the phase leaves authenticating (a canceled or
    /// failed leg returns here, and the spinner must not linger on the wrong button).
    @State private var pending: Provider?

    public init(
        state: WelcomeState,
        onContinueApple: @escaping () -> Void,
        onContinueDiscord: @escaping () -> Void
    ) {
        self.state = state
        self.onContinueApple = onContinueApple
        self.onContinueDiscord = onContinueDiscord
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
                // Apple sits above Discord (App Store guideline 4.8: when third-party
                // sign-in is offered, Sign in with Apple stands at least as prominent).
                providerButton(
                    .apple,
                    systemImage: "apple.logo",
                    label: ArrivalCopy.continueWithApple,
                    action: onContinueApple)
                providerButton(
                    .discord,
                    systemImage: nil,
                    label: ArrivalCopy.continueWithDiscord,
                    action: onContinueDiscord)
            }
        }
        .onChange(of: state) { _, newState in
            if newState != .authenticating { pending = nil }
        }
    }

    /// One glass capsule per provider. The spinner shows only on the button that fired;
    /// both disable while the sheet is up. The optional glyph precedes the copy (Apple
    /// carries its mark; Discord is text alone, matching the prior single-button form).
    private func providerButton(
        _ provider: Provider,
        systemImage: String?,
        label: String,
        action: @escaping () -> Void
    ) -> some View {
        Button {
            pending = provider
            action()
        } label: {
            ZStack {
                HStack(spacing: 8) {
                    if let systemImage {
                        Image(systemName: systemImage)
                            .font(.system(size: 16, weight: .semibold))
                    }
                    Text(verbatim: label)
                        .font(.system(size: 16, weight: .semibold))
                }
                .foregroundStyle(Color(rgb: ground.tokens.ink))
                .opacity(showsSpinner(for: provider) ? 0 : 1)
                if showsSpinner(for: provider) {
                    ProgressView()
                        .tint(Color(rgb: ground.tokens.ink))
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: ChromeLayout.barHeight)
            // The whole capsule is the button (owner device finding 2026-07-10:
            // a plain-style label's transparent expanse does not hit-test, so
            // without this only the label took the tap).
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .modifier(ChromeGlassSurface(cornerRadius: ChromeLayout.barCornerRadius))
        .disabled(state == .authenticating)
    }

    private func showsSpinner(for provider: Provider) -> Bool {
        state == .authenticating && pending == provider
    }
}

#Preview("Welcome, Studio") {
    WelcomeScreen(state: .ready, onContinueApple: {}, onContinueDiscord: {})
}

#Preview("Welcome, authenticating, Studio") {
    WelcomeScreen(state: .authenticating, onContinueApple: {}, onContinueDiscord: {})
}

#Preview("Welcome, failed, Observatory") {
    WelcomeScreen(state: .failed, onContinueApple: {}, onContinueDiscord: {})
        .preferredColorScheme(.dark)
}
