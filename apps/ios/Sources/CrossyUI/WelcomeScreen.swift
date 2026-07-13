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
    private let onContinueHisbaan: () -> Void
    private let sendEmailOTP: (String) async throws -> Void
    private let verifyEmailOTP: (String, String) async throws -> Void
    private let onOpenLegal: (LegalPage) -> Void
    /// The hidden captcha web view, built by the composition root (WebKit lives in the
    /// app target, AD-2: the CameraScan/SafariSheet precedent). It renders nothing in the
    /// calm case (invisible Turnstile) and reveals itself in place only on a forced
    /// interactive challenge. Type-erased to keep WelcomeScreen non-generic (it holds a
    /// static wordmark; a generic type could not). Placed inside the code pane so a
    /// revealed challenge appears where the person is looking; the fixture and previews
    /// pass an empty view (no captcha).
    private let captchaView: () -> AnyView

    @Environment(\.colorScheme) private var colorScheme
    @State private var typedCells = 0
    /// The button that fired; reset when the phase leaves authenticating (a canceled or
    /// failed leg returns here, and the spinner must not linger on the wrong button).
    @State private var pending: Provider?
    /// The "Continue another way" sheet's presentation. Sign-in completion is observed
    /// through the phase (the shell swaps away from Welcome), so this only needs to fall
    /// on a hand dismiss or a hisbaan hand-off (the sheet dismisses itself, then the web
    /// leg raises).
    @State private var showAnotherWay = false

    public init(
        state: WelcomeState,
        onContinueApple: @escaping () -> Void,
        onContinueDiscord: @escaping () -> Void,
        onContinueHisbaan: @escaping () -> Void = {},
        sendEmailOTP: @escaping (String) async throws -> Void = { _ in },
        verifyEmailOTP: @escaping (String, String) async throws -> Void = { _, _ in },
        onOpenLegal: @escaping (LegalPage) -> Void,
        captchaView: @escaping () -> AnyView = { AnyView(EmptyView()) }
    ) {
        self.state = state
        self.onContinueApple = onContinueApple
        self.onContinueDiscord = onContinueDiscord
        self.onContinueHisbaan = onContinueHisbaan
        self.sendEmailOTP = sendEmailOTP
        self.verifyEmailOTP = verifyEmailOTP
        self.onOpenLegal = onOpenLegal
        self.captchaView = captchaView
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
        // The secondary methods (roadmap I3b): a native sheet, medium detent, its own
        // NavigationStack. Sign-in completion is observed from the phase (the shell
        // swaps this whole screen away), so nothing here dismisses on success; the
        // sheet only closes on a hand dismiss or when hisbaan hands off to the web leg.
        .sheet(isPresented: $showAnotherWay) {
            ContinueAnotherWaySheet(
                ground: ground,
                onContinueHisbaan: {
                    // Dismiss first, then raise the web leg: the same read as a
                    // primary button, and the spinner shows on the Welcome frame the
                    // sheet melts back to (state drives to .authenticating).
                    showAnotherWay = false
                    onContinueHisbaan()
                },
                sendEmailOTP: sendEmailOTP,
                verifyEmailOTP: verifyEmailOTP,
                captchaView: captchaView)
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
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
                anotherWayButton
            }
            legalFooter
        }
        .onChange(of: state) { _, newState in
            if newState != .authenticating { pending = nil }
        }
    }

    /// The quiet tertiary affordance under the two primary buttons: a subdued text
    /// button, not a glass capsule, so Apple and Discord stay the first-class way in and
    /// this reads as the escape hatch it is. It opens the secondary-methods sheet.
    /// Disabled while a primary leg is in flight, so it never stacks a sheet over the web
    /// sheet.
    private var anotherWayButton: some View {
        Button {
            showAnotherWay = true
        } label: {
            Text(verbatim: ArrivalCopy.continueAnotherWay)
                .font(.system(size: 14))
                .foregroundStyle(Color(rgb: ground.tokens.number))
        }
        .buttonStyle(.plain)
        .padding(.top, 2)
        .disabled(state == .authenticating)
    }

    /// The quiet legal pair, visible before any sign-in intent. Buttons, not Links:
    /// each reports its page through onOpenLegal and the composition root presents
    /// an in-app Safari sheet, which keeps the person in the flow (App Review
    /// guideline 5.1.1 expects the policy reachable without leaving the app) and is
    /// no dead end (the system sheet carries its own Done button and Safari chrome).
    private var legalFooter: some View {
        HStack(spacing: 6) {
            legalButton(ArrivalCopy.privacyPolicy, page: .privacy)
            Text(verbatim: "·")
                .font(.system(size: 12))
                .foregroundStyle(Color(rgb: ground.tokens.number).opacity(0.7))
            legalButton(ArrivalCopy.termsOfService, page: .terms)
        }
        .padding(.top, 2)
    }

    private func legalButton(_ label: String, page: LegalPage) -> some View {
        Button {
            onOpenLegal(page)
        } label: {
            Text(verbatim: label)
                .font(.system(size: 12))
                .foregroundStyle(Color(rgb: ground.tokens.number).opacity(0.7))
        }
        .buttonStyle(.plain)
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

// MARK: - Continue another way (roadmap I3b)

/// The secondary-methods sheet: a small NavigationStack behind the "Continue another
/// way" affordance. Root is two rows (Email, Hisbaan); Email pushes the address step,
/// then the code step. Hisbaan hands off to the web leg (the parent dismisses this
/// sheet, then raises ASWebAuth, so the read matches a primary button). Sign-in
/// COMPLETION is not this sheet's job: the phase flips to signed in and the whole
/// Welcome screen (this sheet with it) swaps to the shell, exactly as Apple and
/// Discord do. This holds only the local send/verify sub-state.
private struct ContinueAnotherWaySheet: View {
    let ground: GridGround
    let onContinueHisbaan: () -> Void
    let sendEmailOTP: (String) async throws -> Void
    let verifyEmailOTP: (String, String) async throws -> Void
    /// The hidden captcha web view, forwarded to the email leg (only the email step
    /// mints a token). Opaque to CrossyUI (WebKit lives in the app target).
    let captchaView: () -> AnyView

    /// The one thing this stack can push: the email leg. The address-then-code
    /// transition lives inside that view (one view keeps the address in hand across a
    /// resend), so the route needs no payload.
    private enum Step: Hashable {
        case email
    }

    @State private var path: [Step] = []

    var body: some View {
        NavigationStack(path: $path) {
            List {
                NavigationLink(value: Step.email) {
                    Label(ArrivalCopy.continueRowEmail, systemImage: "envelope")
                        .foregroundStyle(Color(rgb: ground.tokens.ink))
                }
                Button {
                    onContinueHisbaan()
                } label: {
                    Label(ArrivalCopy.continueRowHisbaan, systemImage: "person.badge.key")
                        .foregroundStyle(Color(rgb: ground.tokens.ink))
                }
            }
            .navigationTitle(ArrivalCopy.continueSheetTitle)
            #if os(iOS)
                .listStyle(.insetGrouped)
                .navigationBarTitleDisplayMode(.inline)
            #endif
            .navigationDestination(for: Step.self) { _ in
                EmailFlowView(
                    ground: ground,
                    sendEmailOTP: sendEmailOTP,
                    verifyEmailOTP: verifyEmailOTP,
                    captchaView: captchaView)
            }
        }
        .tint(Color(rgb: ground.tokens.ink))
    }
}

/// The email leg inside the sheet: address then code, one view owning the two
/// sub-states so a resend keeps the same email in hand. Send and verify are the
/// injected closures (they reach AuthSession through the composition root); this view
/// owns only the calm in-flight and error states. Verify is disabled while a verify is
/// in flight (the flag in the brief: a double verify silently no-ops in the state
/// machine, so re-entrancy is prevented here, not detected by a throw).
private struct EmailFlowView: View {
    let ground: GridGround
    let sendEmailOTP: (String) async throws -> Void
    let verifyEmailOTP: (String, String) async throws -> Void
    /// The hidden Turnstile web view (app-target owned), type-erased. It sits in the code
    /// pane from the first send onward so a forced interactive challenge can reveal itself
    /// in place; in the calm case it renders nothing and takes no space. sendEmailOTP
    /// mints the token behind this closure, so this view stays token-blind.
    let captchaView: () -> AnyView

    /// The digits the OTP carries. Supabase is configured for an 8-digit code, so the
    /// field caps and the verify gate both count to this (a stale 6 would reject valid
    /// codes and mislead the copy). Sourced from the one public constant so the field,
    /// the gate, and the copy never drift apart.
    static var codeLength: Int { ArrivalCopy.emailOTPCodeLength }

    /// Where the email leg stands. `codeSent` carries no data (the email lives in its
    /// own field), it just gates which pane shows.
    private enum Phase: Equatable {
        case address
        case sending
        case codeSent
        case verifying
    }

    /// The resend cooldown, so a person can retry a lost code without spamming the send.
    private static let resendCooldown = 30

    @State private var email = ""
    @State private var code = ""
    @State private var phase: Phase = .address
    @State private var errorText: String?
    @State private var resendRemaining = 0
    /// The wall-clock deadline the cooldown counts down to (see startResendCooldown).
    @State private var resendUntil: Date?
    @FocusState private var focus: Field?
    @Environment(\.scenePhase) private var scenePhase

    private enum Field {
        case email
        case code
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            if phase == .codeSent || phase == .verifying {
                codePane
            } else {
                addressPane
            }
            // The hidden captcha web view lives at the pane level (not inside either
            // pane) so it stays mounted across the address to code switch: a send fired
            // from the address pane can still reveal a challenge here, and a resend from
            // the code pane reuses the same widget. It renders nothing and takes no space
            // in the calm case; on a forced challenge it reveals itself and grows. The
            // fixture and previews pass an empty view, so this is inert there.
            captchaView()
            Spacer()
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(rgb: ground.tokens.canvas).ignoresSafeArea())
        .navigationTitle(
            phase == .codeSent || phase == .verifying
                ? ArrivalCopy.codeEntryTitle : ArrivalCopy.emailEntryTitle)
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
        .onChange(of: scenePhase) { _, newPhase in
            // The cooldown deadline is wall-clock, so recompute on foreground: a
            // countdown that elapsed while the app was backgrounded shows as cleared
            // right away instead of resuming from where it froze.
            if newPhase == .active { refreshResendRemaining() }
        }
    }

    // MARK: - Address pane

    private var addressPane: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(verbatim: ArrivalCopy.emailEntryHint)
                .font(.system(size: 14))
                .foregroundStyle(Color(rgb: ground.tokens.number))
            TextField(ArrivalCopy.emailFieldPrompt, text: $email)
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled()
                .submitLabel(.send)
                .focused($focus, equals: .email)
                .onSubmit { Task { await send() } }
                #if os(iOS)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .textContentType(.emailAddress)
                #endif
            if let errorText {
                errorLine(errorText)
            }
            actionButton(
                title: ArrivalCopy.emailSendCode,
                inFlight: phase == .sending,
                enabled: canSend
            ) {
                Task { await send() }
            }
        }
        .onAppear { focus = .email }
    }

    // MARK: - Code pane

    private var codePane: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(verbatim: ArrivalCopy.codeEntryHint(email: email))
                .font(.system(size: 14))
                .foregroundStyle(Color(rgb: ground.tokens.number))
            TextField(ArrivalCopy.codeFieldPrompt, text: $code)
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 20, weight: .medium, design: .monospaced))
                .focused($focus, equals: .code)
                .onChange(of: code) { _, new in
                    // Numeric only, capped at the OTP length (Supabase's 8 digits): the
                    // field stays a clean OTP field without a custom keypad (native
                    // numberPad, plain filtering).
                    let digits = new.filter { $0.isNumber }
                    code = String(digits.prefix(Self.codeLength))
                }
                #if os(iOS)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                #endif
            if let errorText {
                errorLine(errorText)
            }
            actionButton(
                title: ArrivalCopy.codeVerify,
                inFlight: phase == .verifying,
                enabled: canVerify
            ) {
                Task { await verify() }
            }
            resendControl
        }
        .onAppear { focus = .code }
    }

    /// Resend with a cooldown: live while counting down (a plain caption), a button once
    /// it clears. A resend just runs the send leg again with the same address.
    @ViewBuilder
    private var resendControl: some View {
        if resendRemaining > 0 {
            Text(verbatim: ArrivalCopy.codeResendCountdown(seconds: resendRemaining))
                .font(.system(size: 13))
                .foregroundStyle(Color(rgb: ground.tokens.number).opacity(0.8))
        } else {
            Button(ArrivalCopy.codeResend) {
                Task { await resend() }
            }
            .font(.system(size: 13))
            .foregroundStyle(Color(rgb: ground.tokens.number))
            .disabled(phase == .verifying)
        }
    }

    // MARK: - Pieces

    private func errorLine(_ text: String) -> some View {
        Text(verbatim: text)
            .font(.system(size: 13))
            .foregroundStyle(Color(rgb: ground.tokens.number))
    }

    /// One filled action button, calm and consistent across the two steps: the label,
    /// or a spinner while its leg is in flight. Disabled state carries the same reasons
    /// the two panes gate on.
    private func actionButton(
        title: String,
        inFlight: Bool,
        enabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            ZStack {
                Text(verbatim: title)
                    .font(.system(size: 16, weight: .semibold))
                    .opacity(inFlight ? 0 : 1)
                if inFlight {
                    ProgressView().tint(Color(rgb: ground.tokens.canvas))
                }
            }
            .foregroundStyle(Color(rgb: ground.tokens.canvas))
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color(rgb: ground.tokens.ink).opacity(enabled ? 1 : 0.4)))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    // MARK: - Gating

    private var canSend: Bool {
        phase != .sending && email.contains("@") && !email.hasSuffix("@")
    }

    private var canVerify: Bool {
        // Disabled while a verify is in flight (the re-entrancy flag: a second verify
        // no-ops in the state machine, so it must be blocked here, not caught later).
        // The code is complete at the OTP length (Supabase's 8 digits).
        phase != .verifying && code.count == Self.codeLength
    }

    // MARK: - Legs

    private func send() async {
        guard canSend else { return }
        errorText = nil
        phase = .sending
        do {
            try await sendEmailOTP(email)
            phase = .codeSent
            focus = .code
            startResendCooldown()
        } catch {
            phase = .address
            errorText = ArrivalCopy.emailSendFailed
        }
    }

    private func resend() async {
        errorText = nil
        do {
            try await sendEmailOTP(email)
            startResendCooldown()
        } catch {
            errorText = ArrivalCopy.emailSendFailed
        }
    }

    private func verify() async {
        guard canVerify else { return }
        errorText = nil
        phase = .verifying
        do {
            try await verifyEmailOTP(email, code)
            // Success flips the phase to signed in; the sheet swaps away with the
            // whole Welcome screen, so nothing here dismisses. Stay in .verifying so
            // the button keeps its spinner through that swap.
        } catch {
            phase = .codeSent
            errorText = ArrivalCopy.codeVerifyFailed
        }
    }

    /// Anchor the cooldown to a wall-clock deadline so backgrounding the app never
    /// freezes it: the per-second tick and a return to the foreground both recompute
    /// the remaining seconds from `resendUntil` rather than decrementing a counter.
    private func startResendCooldown() {
        resendUntil = Date().addingTimeInterval(Double(Self.resendCooldown))
        refreshResendRemaining()
        Task {
            while resendRemaining > 0 {
                try? await Task.sleep(for: .seconds(1))
                refreshResendRemaining()
            }
        }
    }

    private func refreshResendRemaining() {
        guard let until = resendUntil else {
            resendRemaining = 0
            return
        }
        resendRemaining = max(0, Int(until.timeIntervalSinceNow.rounded(.up)))
    }
}

#Preview("Welcome, Studio") {
    WelcomeScreen(
        state: .ready, onContinueApple: {}, onContinueDiscord: {}, onOpenLegal: { _ in })
}

#Preview("Welcome, authenticating, Studio") {
    WelcomeScreen(
        state: .authenticating, onContinueApple: {}, onContinueDiscord: {},
        onOpenLegal: { _ in })
}

#Preview("Welcome, failed, Observatory") {
    WelcomeScreen(
        state: .failed, onContinueApple: {}, onContinueDiscord: {}, onOpenLegal: { _ in }
    )
    .preferredColorScheme(.dark)
}

// The secondary-methods sheet in isolation (the two rows, then the email leg). The
// stubbed send always succeeds so the code pane is reachable on device; verify always
// fails so the calm error copy is judgeable without a live server.
#Preview("Continue another way, Studio") {
    Color(rgb: GridGround.studio.tokens.canvas)
        .ignoresSafeArea()
        .sheet(isPresented: .constant(true)) {
            ContinueAnotherWaySheet(
                ground: .studio,
                onContinueHisbaan: {},
                sendEmailOTP: { _ in },
                verifyEmailOTP: { _, _ in throw CancellationError() },
                captchaView: { AnyView(EmptyView()) })
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
        }
}
