// Display-name onboarding (docs/design/name-onboarding.md §9): the moment an
// authenticated user is found nameless, a sheet over the shell lands a real name in the
// app DB. Beautiful and idiomatic to the arrival grammar (paper below, glass above): the
// live RosterPuckView preview, a glass-surfaced field, a glass-capsule Continue, all on
// the current Ground. Not skippable but never a dead end (§9.3): the field is prefilled
// with a valid suggestion, so the fast path is one tap on Continue.
//
// AD-2: this screen sees plain data and one async closure, never CrossyAPI. The
// composition root injects `submit`, which wraps CrossyAPIClient.updateDisplayName and
// maps its result into the typed DisplayNameOutcome the model keys on. The R4 resilient
// submit (auto-retry with backoff on transport/5xx, honor Retry-After on 429, adopt
// locally after bounded retries, never sign out) lives in DisplayNameOnboardingModel so
// it is drivable in a test without the network.

import CrossyDesign
import SwiftUI

/// The result of one `submit` attempt, as the onboarding model keys on it. The stable
/// §12 code strings ride through unparsed (CrossyUI does not import CrossyProtocol, AD-2),
/// exactly as ArrivalFailure carries them: the composition root digests the client error
/// into one of these and the model renders the calm sentence from the code alone.
public enum DisplayNameOutcome: Sendable, Equatable {
    /// The server confirmed and returned the canonical stored name; adopt it and dismiss.
    case saved(canonical: String)
    /// A well-formed name that violates a rule (a `NAME_*` 422): show the inline error
    /// keyed on the code and keep the sheet. Not a lockout, the prefill is always valid.
    case nameRejected(code: String)
    /// The write window is spent (429). Honor `retryAfter` (seconds) before the next
    /// auto-retry and show the rate-limit copy; nil falls back to the model's backoff.
    case rateLimited(retryAfter: TimeInterval?)
    /// Transport weather or a 5xx: nothing was judged. The model auto-retries with backoff
    /// (never a sign-out, INV-11). `code` is nil for network weather or the stable code
    /// for a server-side transient, only used to render the calm sentence.
    case retryable(code: String?)
}

/// The onboarding submit state machine (R4). Owns the field draft, the in-flight and
/// error states, and the bounded auto-retry loop over an injected `submit` closure. A
/// MainActor @Observable so the sheet binds to it; extracted from the view so the resilient
/// submit is testable headless. The name is authoritative only once the server confirms;
/// after `maxAutoRetries` fail on transient weather the model surfaces a retry-tone error
/// and lets the person tap Continue again (retry is always available, never a hard wall).
@available(iOS 17.0, macOS 14.0, *)
@MainActor
@Observable
public final class DisplayNameOnboardingModel {
    /// The field's current text, sanitized on every set through DisplayNameEntry so it
    /// never holds a shape the server rejects (it still trims/collapses server-side).
    public var draft: String {
        didSet {
            let clean = DisplayNameEntry.sanitize(draft)
            if clean != draft { draft = clean }
        }
    }

    /// The stable §12 code of the current inline error, nil when there is none. `nil` as a
    /// present error (offline) is distinguished from "no error" by `hasError`.
    public private(set) var errorCode: String?
    public private(set) var hasError = false
    public private(set) var isSaving = false

    /// The injected submit: one attempt over the wire, its result digested to a typed
    /// outcome by the composition root. Async, so the model awaits it and drives the loop.
    private let submit: (String) async -> DisplayNameOutcome
    /// Called with the canonical name on a confirmed save, so the composition root adopts
    /// it into AccountIdentity and dismisses the sheet.
    private let onSaved: (String) -> Void

    /// How many times a transient failure auto-retries before the model hands control back
    /// to the person. Bounded so the app never spins forever; retry stays available after.
    public let maxAutoRetries: Int
    /// The base backoff between auto-retries; the model multiplies it by the attempt index
    /// (a gentle linear-ish backoff). A 429 overrides it with the server's Retry-After.
    private let baseBackoff: TimeInterval
    /// Injected sleep, so a test drives the loop with no real delay. Defaults to real sleep.
    private let sleep: (TimeInterval) async -> Void

    public init(
        prefill: String,
        submit: @escaping (String) async -> DisplayNameOutcome,
        onSaved: @escaping (String) -> Void,
        maxAutoRetries: Int = 3,
        baseBackoff: TimeInterval = 0.6,
        sleep: @escaping (TimeInterval) async -> Void = { seconds in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
        }
    ) {
        self.draft = DisplayNameEntry.sanitize(prefill)
        self.submit = submit
        self.onSaved = onSaved
        self.maxAutoRetries = max(0, maxAutoRetries)
        self.baseBackoff = baseBackoff
        self.sleep = sleep
    }

    /// The Continue button is enabled only when the sanitized draft is non-empty. A
    /// whitespace-only draft canonicalizes to empty (NAME_REQUIRED), so gate on the
    /// canonical form: the fast path stays a single tap, and an empty field cannot submit.
    public var canSubmit: Bool {
        !DisplayNameEntry.canonicalize(draft).isEmpty
    }

    /// Submit the draft (R4). One edge validate, then the resilient loop: a confirmed save
    /// adopts and dismisses; a `NAME_*` rejection shows the inline error and keeps the
    /// sheet; transport/5xx auto-retries with backoff up to the cap; a 429 waits out
    /// Retry-After and retries. Never signs out (INV-11), never walls the app (after the
    /// cap the error is shown and Continue is tappable again). Re-entrancy is blocked by
    /// `isSaving`.
    public func submitDraft() async {
        guard !isSaving, canSubmit else { return }
        isSaving = true
        clearError()
        defer { isSaving = false }

        // Validate at the edge first, so a locally-detectable NAME_* never costs a round
        // trip. The canonical value is what the server would store; send it.
        let canonical = DisplayNameEntry.canonicalize(draft)
        guard DisplayNameEntry.isComplete(canonical) else {
            // The only way isComplete fails here (canSubmit already ruled out empty) is a
            // disallowed scalar sanitize somehow missed; surface it as the name error.
            setError(code: "NAME_INVALID")
            return
        }

        var attempt = 0
        while true {
            switch await submit(canonical) {
            case .saved(let stored):
                clearError()
                onSaved(stored)
                return
            case .nameRejected(let code):
                setError(code: code)
                return
            case .rateLimited(let retryAfter):
                setError(code: "RATE_LIMITED")
                guard attempt < maxAutoRetries else { return }
                attempt += 1
                await sleep(retryAfter ?? backoff(forAttempt: attempt))
                clearError()
            case .retryable(let code):
                guard attempt < maxAutoRetries else {
                    // The bounded retries are spent; hand control back with a retry-tone
                    // error. Continue stays tappable, so retry is always available.
                    setError(code: code)
                    return
                }
                attempt += 1
                await sleep(backoff(forAttempt: attempt))
            }
        }
    }

    private func backoff(forAttempt attempt: Int) -> TimeInterval {
        baseBackoff * TimeInterval(attempt)
    }

    private func setError(code: String?) {
        errorCode = code
        hasError = true
    }

    private func clearError() {
        errorCode = nil
        hasError = false
    }
}

/// The onboarding sheet itself (§9.2): title, subtitle, a live puck preview, a glass
/// field, an inline error, and a full-width glass Continue capsule, on the current Ground.
/// Presented with `.presentationDetents([.medium])`, a hidden drag indicator, and
/// `.interactiveDismissDisabled(true)` (§9.3: not dismissable while nameless). The prefill
/// is a valid suggestion, so "not skippable" costs one tap, not an act of self-naming.
@available(iOS 17.0, macOS 14.0, *)
public struct DisplayNameOnboardingSheet: View {
    private let ground: GridGround
    /// The caller's real user id, so the puck's roster color is stable and real (§9.2).
    private let userId: String
    /// The resolved avatar URL, layered over the initial in the live preview when present.
    private let avatarUrl: String?

    @Bindable private var model: DisplayNameOnboardingModel
    /// A private avatar cache so the puck's avatar layer resolves outside a room (the
    /// SettingsScreen pattern: this sheet mounts its own).
    @State private var avatarCache = AvatarImageCache()
    @FocusState private var fieldFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(
        ground: GridGround,
        userId: String,
        avatarUrl: String?,
        model: DisplayNameOnboardingModel
    ) {
        self.ground = ground
        self.userId = userId
        self.avatarUrl = avatarUrl
        self.model = model
    }

    /// The live preview member: real id (real color), the current draft as the name (so
    /// the initial recomputes as the person types), the real avatar. Always connected.
    private var previewMember: RosterMember {
        RosterMember(
            userId: userId,
            displayName: model.draft,
            wireColor: "",
            avatarUrl: avatarUrl,
            isHost: false,
            isSpectator: false,
            connected: true)
    }

    public var body: some View {
        VStack(spacing: 0) {
            Text(verbatim: ArrivalCopy.displayNameTitle)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(Color(rgb: ground.tokens.ink))
                .multilineTextAlignment(.center)
                .padding(.top, 28)

            Text(verbatim: ArrivalCopy.displayNameOnboardingHint)
                .font(.system(size: 15))
                .foregroundStyle(Color(rgb: ground.tokens.number))
                .multilineTextAlignment(.center)
                .padding(.top, 8)
                .padding(.horizontal, 8)

            RosterPuckView(member: previewMember, ground: ground, diameter: 64)
                // The puck is decorative here (the name is announced by the field), so
                // hide it from VoiceOver (§15). RosterPuckBody already hides itself; this
                // keeps the intent explicit at the preview site.
                .accessibilityHidden(true)
                // Swap the value with no spring/cross-fade when Reduce Motion is on (§15).
                .animation(reduceMotion ? nil : .crossyChrome, value: model.draft)
                .padding(.top, 24)

            field
                .padding(.top, 24)

            errorLine
                .padding(.top, 8)

            Spacer(minLength: 16)

            continueButton
                .padding(.bottom, 20)
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(rgb: ground.tokens.canvas).ignoresSafeArea())
        .environment(\.avatarImageCache, avatarCache)
        .presentationDetents([.medium])
        .presentationDragIndicator(.hidden)
        // Required: the sheet is not dismissable while the account is nameless (§9.3). The
        // valid prefill means this is one tap from done, not a trap.
        .interactiveDismissDisabled(true)
        .onAppear { fieldFocused = true }
    }

    /// The glass-surfaced field (§9.2): a TextField wrapped in ChromeGlassSurface so it
    /// reads as chrome material. Word-capitalized, focused on appear, its text bound
    /// straight to the sanitizing model draft. Labeled for VoiceOver; the error is
    /// announced through the field's accessibility value so a change is spoken (§15).
    private var field: some View {
        TextField(ArrivalCopy.displayNameFieldPrompt, text: $model.draft)
            .textFieldStyle(.plain)
            .font(.system(size: 17))
            .foregroundStyle(Color(rgb: ground.tokens.ink))
            .multilineTextAlignment(.center)
            .submitLabel(.done)
            .focused($fieldFocused)
            .onSubmit { Task { await model.submitDraft() } }
            #if os(iOS)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
            #endif
            .padding(.vertical, 16)
            .padding(.horizontal, 18)
            .modifier(ChromeGlassSurface(cornerRadius: 14))
            .accessibilityLabel(ArrivalCopy.displayNameFieldPrompt)
            .accessibilityValue(
                model.hasError ? ArrivalCopy.displayNameError(forCode: model.errorCode) : "")
    }

    @ViewBuilder
    private var errorLine: some View {
        if model.hasError {
            Text(verbatim: ArrivalCopy.displayNameError(forCode: model.errorCode))
                .font(.system(size: 13))
                .foregroundStyle(.red)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity, alignment: .center)
                // Announce the error to VoiceOver the instant it changes (§15).
                .accessibilityAddTraits(.isStaticText)
        }
    }

    /// The full-width glass capsule Continue (§9.2): the primary-action material, bar
    /// height, the capsule spinner while saving, disabled when the sanitized draft is
    /// empty. The whole capsule takes the tap (the WelcomeScreen finding).
    private var continueButton: some View {
        Button {
            Task { await model.submitDraft() }
        } label: {
            ZStack {
                Text(verbatim: ArrivalCopy.displayNameSave)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color(rgb: ground.tokens.ink))
                    .opacity(model.isSaving ? 0 : 1)
                if model.isSaving {
                    ProgressView().tint(Color(rgb: ground.tokens.ink))
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: ChromeLayout.barHeight)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .modifier(ChromeGlassSurface(cornerRadius: ChromeLayout.barCornerRadius))
        .opacity(model.canSubmit ? 1 : 0.4)
        .disabled(!model.canSubmit || model.isSaving)
        .accessibilityLabel(ArrivalCopy.displayNameSave)
    }
}

#Preview("Onboarding, Studio") {
    if #available(iOS 17.0, macOS 14.0, *) {
        Color(rgb: GridGround.studio.tokens.canvas)
            .ignoresSafeArea()
            .sheet(isPresented: .constant(true)) {
                DisplayNameOnboardingSheet(
                    ground: .studio,
                    userId: "11111111-2222-3333-4444-555555555555",
                    avatarUrl: nil,
                    model: DisplayNameOnboardingModel(
                        prefill: "Quiet Comet",
                        submit: { _ in .saved(canonical: "Quiet Comet") },
                        onSaved: { _ in }))
            }
    }
}

#Preview("Onboarding, name rejected, Observatory") {
    if #available(iOS 17.0, macOS 14.0, *) {
        Color(rgb: GridGround.observatory.tokens.canvas)
            .ignoresSafeArea()
            .sheet(isPresented: .constant(true)) {
                DisplayNameOnboardingSheet(
                    ground: .observatory,
                    userId: "abcdef01-2345-6789-abcd-ef0123456789",
                    avatarUrl: nil,
                    model: DisplayNameOnboardingModel(
                        prefill: "Amber Vireo",
                        submit: { _ in .nameRejected(code: "NAME_TOO_LONG") },
                        onSaved: { _ in }))
                    .preferredColorScheme(.dark)
            }
    }
}
