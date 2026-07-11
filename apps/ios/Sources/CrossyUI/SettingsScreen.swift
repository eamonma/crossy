// The Account screen (roadmap I3: thin settings v1, owner ruling "thin for now").
// Exactly three things and nothing else: who is signed in (avatar, name, provider),
// sign out, and a destructive delete with a two-beat confirmation. No theme toggle
// (ID-3: both grounds ship, system-driven), no notifications. A quiet version footer
// rides at the bottom.
//
// AD-2: the screen sees plain data and closures, never CrossyAPI or the auth machine.
// The composition root maps the session's identity into AccountIdentity and adapts the
// sign-out and delete intents. The identity puck reuses the roster vocabulary
// (RosterPuckView over a RosterMember built from the account facts), so avatar, color,
// and initial resolve exactly as they do in the room.
//
// The delete confirmation is a system confirmationDialog with a destructive action
// (the tap-opened-panel grammar: system presentations are allowed for tap-opened
// surfaces, the Mail-mechanism ruling, DESIGN.md §4). A failed delete renders inline
// on this surface, never silent, and stays retryable (the arrival error voice).

import CrossyDesign
import SwiftUI

/// The signed-in person as the settings surface renders them, plain data mapped by the
/// composition root from the auth session. Display name is not persisted yet, so it is
/// optional and the puck's initial falls back to empty (the roster's own first-class
/// fallback); the userId drives the deterministic roster color either way.
public struct AccountIdentity: Sendable, Equatable {
    public let userId: String
    /// The display name when auth state holds one; nil renders the plain "Signed in".
    public let displayName: String?
    /// The provider line beneath the name (Discord, Apple), or nil when a pre-marker
    /// session was restored and none is remembered.
    public let providerLabel: String?
    /// The opaque avatar URL when one is known, layered over the initial puck exactly
    /// as in the room (PROTOCOL.md §4). nil renders the colored initial alone.
    public let avatarUrl: String?

    public init(
        userId: String,
        displayName: String?,
        providerLabel: String?,
        avatarUrl: String? = nil
    ) {
        self.userId = userId
        self.displayName = displayName
        self.providerLabel = providerLabel
        self.avatarUrl = avatarUrl
    }

    /// The identity as a roster member, so the puck reuses RosterPuckView verbatim
    /// (color from the id, initial from the name, avatar layered when present). A
    /// solo self-puck: always "connected", never host or spectator here.
    var rosterMember: RosterMember {
        RosterMember(
            userId: userId,
            displayName: displayName ?? "",
            wireColor: "",
            avatarUrl: avatarUrl,
            isHost: false,
            isSpectator: false,
            connected: true)
    }
}

@available(iOS 17.0, macOS 14.0, *)
public struct SettingsScreen: View {
    private let identity: AccountIdentity
    /// A quiet version footer when the composition root supplies one (e.g. "1.0 (12)"),
    /// nil in previews and where the bundle carries none.
    private let versionLabel: String?
    /// Where the Privacy Policy row opens (the live /privacy page on the web origin).
    private let privacyURL: URL
    private let onSignOut: () -> Void
    /// Delete the account; nil means success (the parent lands at Welcome), a failure
    /// carries the stable code the inline sentence keys on.
    private let onDeleteAccount: () async -> ArrivalFailure?

    @Environment(\.colorScheme) private var colorScheme
    @State private var confirmingDelete = false
    @State private var deleting = false
    @State private var deleteFailure: ArrivalFailure?
    // The identity puck is a live RosterPuckView, so its avatar layer reads a cache
    // from the environment (AvatarImage). This screen mounts outside the room, so it
    // owns its own instance; without one the puck would have no cache to load from and
    // stay the colored initial (its one puck makes a shared cache unnecessary).
    @State private var avatarCache = AvatarImageCache()

    public init(
        identity: AccountIdentity,
        versionLabel: String? = nil,
        privacyURL: URL,
        onSignOut: @escaping () -> Void,
        onDeleteAccount: @escaping () async -> ArrivalFailure?
    ) {
        self.identity = identity
        self.versionLabel = versionLabel
        self.privacyURL = privacyURL
        self.onSignOut = onSignOut
        self.onDeleteAccount = onDeleteAccount
    }

    private var ground: GridGround {
        colorScheme == .dark ? .observatory : .studio
    }

    public var body: some View {
        VStack(spacing: 0) {
            title
            identityRow
                .padding(.top, 28)
                .padding(.horizontal, 24)

            Spacer()

            if let deleteFailure {
                Text(verbatim: ArrivalCopy.deleteFailure(forCode: deleteFailure.code))
                    .font(.system(size: 14))
                    .foregroundStyle(Color(rgb: ground.tokens.number))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 12)
            }

            actions
                .padding(.horizontal, 24)

            privacyRow
                .padding(.top, 14)

            versionFooter
                .padding(.top, 20)
                .padding(.bottom, 20)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(rgb: ground.tokens.canvas).ignoresSafeArea())
        // The identity puck's avatar layer reads its cache here (PROTOCOL.md §4: a
        // null or unresolved url just shows the initial).
        .environment(\.avatarImageCache, avatarCache)
        // The two-beat confirmation: a system dialog with a destructive action, its
        // body stating the consequence plainly (roadmap I3). The system owns its
        // placement and dismissal (the Mail-mechanism grammar, DESIGN.md §4).
        .confirmationDialog(
            ArrivalCopy.deleteAccountConfirmTitle,
            isPresented: $confirmingDelete,
            titleVisibility: .visible
        ) {
            Button(ArrivalCopy.deleteAccountConfirmAction, role: .destructive) {
                Task { await runDelete() }
            }
            Button(ArrivalCopy.deleteAccountCancelAction, role: .cancel) {}
        } message: {
            Text(verbatim: ArrivalCopy.deleteAccountConfirmBody)
        }
    }

    private var title: some View {
        Text(verbatim: ArrivalCopy.settingsTitle)
            .font(.system(size: 32, weight: .bold))
            .foregroundStyle(Color(rgb: ground.tokens.ink))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 8)
            .padding(.horizontal, 24)
    }

    /// The person: their puck (roster vocabulary), the name (or the plain fallback),
    /// and the provider line beneath. Read from what auth state holds; no wire call.
    private var identityRow: some View {
        HStack(spacing: 14) {
            RosterPuckView(member: identity.rosterMember, ground: ground, diameter: 52)
            VStack(alignment: .leading, spacing: 3) {
                Text(verbatim: identity.displayName ?? ArrivalCopy.settingsNoName)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Color(rgb: ground.tokens.ink))
                if let providerLabel = identity.providerLabel {
                    Text(verbatim: providerLabel)
                        .font(.system(size: 14))
                        .foregroundStyle(Color(rgb: ground.tokens.number))
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The two standing actions: sign out (a plain glass capsule) and delete (glass, but
    /// its label carries the destructive tone; the confirmation is the real gate). Both
    /// disable while a delete is in flight.
    private var actions: some View {
        VStack(spacing: 14) {
            capsuleButton(
                label: ArrivalCopy.signOutAction,
                tone: Color(rgb: ground.tokens.ink),
                showsSpinner: false,
                action: onSignOut)

            capsuleButton(
                label: ArrivalCopy.deleteAccountAction,
                // Destructive tone, the one warm-red the system reserves for it; chrome
                // stays achromatic, so this is the label's color, never the glass's.
                tone: .red,
                showsSpinner: deleting,
                action: { confirmingDelete = true })
        }
        .disabled(deleting)
    }

    private func capsuleButton(
        label: String,
        tone: Color,
        showsSpinner: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            ZStack {
                Text(verbatim: label)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(tone)
                    .opacity(showsSpinner ? 0 : 1)
                if showsSpinner {
                    ProgressView().tint(tone)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: ChromeLayout.barHeight)
            // The whole capsule takes the tap (the WelcomeScreen finding).
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .modifier(ChromeGlassSurface(cornerRadius: ChromeLayout.barCornerRadius))
    }

    /// The fourth row: a quiet link out to the live policy, standing apart from the
    /// two capsule actions so it never reads as a fourth account intent (Link, not a
    /// sheet — Safari's own chrome and back button, the WelcomeScreen precedent).
    private var privacyRow: some View {
        Link(destination: privacyURL) {
            Text(verbatim: ArrivalCopy.privacyPolicy)
                .font(.system(size: 14))
                .foregroundStyle(Color(rgb: ground.tokens.number))
        }
    }

    @ViewBuilder
    private var versionFooter: some View {
        if let versionLabel {
            Text(verbatim: versionLabel)
                .font(.system(size: 12).monospacedDigit())
                .foregroundStyle(Color(rgb: ground.tokens.number).opacity(0.7))
        }
    }

    private func runDelete() async {
        deleting = true
        deleteFailure = nil
        defer { deleting = false }
        // Success is the parent's navigation to Welcome (it purges the local tokens on
        // its side). A failure renders inline and stays retryable.
        if let failure = await onDeleteAccount() {
            deleteFailure = failure
        }
    }
}

private let previewPrivacyURL = URL(string: "https://crossy.me/privacy")!

#Preview("Account, Studio") {
    if #available(iOS 17.0, macOS 14.0, *) {
        SettingsScreen(
            identity: AccountIdentity(
                userId: "11111111-2222-3333-4444-555555555555",
                displayName: "Ada Lovelace",
                providerLabel: ArrivalCopy.providerDiscord),
            versionLabel: "1.0 (12)",
            privacyURL: previewPrivacyURL,
            onSignOut: {},
            onDeleteAccount: { nil })
    }
}

#Preview("Account, no name, Observatory") {
    if #available(iOS 17.0, macOS 14.0, *) {
        SettingsScreen(
            identity: AccountIdentity(
                userId: "abcdef01-2345-6789-abcd-ef0123456789",
                displayName: nil,
                providerLabel: ArrivalCopy.providerApple),
            versionLabel: "1.0 (12)",
            privacyURL: previewPrivacyURL,
            onSignOut: {},
            onDeleteAccount: { ArrivalFailure(code: nil) })
    }
}
