// The Account screen (roadmap I3: thin settings v1, owner ruling "thin for now").
// Who is signed in (a paper identity card), the per-device Solving preferences (a
// second paper card), sign out, and a destructive delete with a two-beat confirmation.
// No theme toggle (ID-3: both grounds ship, system-driven), no notifications. A quiet
// legal pair and a version footer close the screen.
//
// The surface is a sibling of Rooms and Puzzles: a ScrollView of paper cards on the
// ground canvas, 16pt inset, a 32pt title, quiet caps section headers. The cards use
// the exact RoomCard recipe — a rounded rect filled with the `cell` token and hairlined
// with `gridLine`, so a settings group reads as one crossword cell of paper (DESIGN.md
// §1: cards are paper/content, glass is chrome you hold). The two standing actions stay
// glass capsules, because a sign-out and a delete are chrome you hold, not content.
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
    private let onSignOut: () -> Void
    /// Delete the account; nil means success (the parent lands at Welcome), a failure
    /// carries the stable code the inline sentence keys on.
    private let onDeleteAccount: () async -> ArrivalFailure?
    /// Open a legal page (the WelcomeScreen grammar): the screen signals intent, the
    /// composition root maps it to the live page and presents the Safari sheet.
    private let onOpenLegal: (LegalPage) -> Void

    /// The per-device typing preferences (personal-settings slice 1), the shared store
    /// the composition root also feeds into the open room, so a change here reaches the
    /// cursor live. `@Bindable` so the toggle and picker write straight through.
    @Bindable private var typingPrefs: NavigationSettingsStore

    @Environment(\.colorScheme) private var colorScheme
    @State private var confirmingDelete = false
    @State private var deleting = false
    @State private var deleteFailure: ArrivalFailure?
    // The identity puck is a live RosterPuckView, so its avatar layer reads a cache
    // from the environment (AvatarImage). This screen mounts outside the room, so it
    // owns its own instance; without one the puck would have no cache to load from and
    // stay the colored initial (its one puck makes a shared cache unnecessary).
    @State private var avatarCache = AvatarImageCache()

    /// The shared inset and card geometry, so the screen sits as a sibling of Rooms and
    /// Puzzles (both 16pt) and its cards echo the RoomCard silhouette (corner 16).
    private enum Layout {
        static let inset: CGFloat = 16
        static let cardCorner: CGFloat = 16
        static let rowPadding: CGFloat = 14
    }

    public init(
        identity: AccountIdentity,
        typingPrefs: NavigationSettingsStore,
        versionLabel: String? = nil,
        onSignOut: @escaping () -> Void,
        onDeleteAccount: @escaping () async -> ArrivalFailure?,
        onOpenLegal: @escaping (LegalPage) -> Void
    ) {
        self.identity = identity
        self.typingPrefs = typingPrefs
        self.versionLabel = versionLabel
        self.onSignOut = onSignOut
        self.onDeleteAccount = onDeleteAccount
        self.onOpenLegal = onOpenLegal
    }

    private var ground: GridGround {
        colorScheme == .dark ? .observatory : .studio
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                title

                identityCard
                    .padding(.top, 12)

                sectionHeader(ArrivalCopy.settingsSolvingSection)
                    .padding(.top, 22)
                    .padding(.bottom, 8)
                solvingCard

                actions
                    .padding(.top, 24)

                if let deleteFailure {
                    Text(verbatim: ArrivalCopy.deleteFailure(forCode: deleteFailure.code))
                        .font(.system(size: 13))
                        .foregroundStyle(Color(rgb: ground.tokens.number))
                        .frame(maxWidth: .infinity, alignment: .center)
                        .multilineTextAlignment(.center)
                        .padding(.top, 12)
                }

                legalRow
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.top, 24)

                versionFooter
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.top, 16)
            }
            .padding(.horizontal, Layout.inset)
            .padding(.top, 8)
            .padding(.bottom, 32)
        }
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
    }

    /// The paper-card background, the RoomCard recipe verbatim: a rounded rect filled
    /// with the `cell` token and hairlined with `gridLine`, so a settings group reads as
    /// one crossword cell of paper (DESIGN.md §1). Reused by both cards so they share a
    /// silhouette with each other and with the room and puzzle cards.
    private func cardBackground() -> some View {
        RoundedRectangle(cornerRadius: Layout.cardCorner, style: .continuous)
            .fill(Color(rgb: ground.tokens.cell))
            .overlay(
                RoundedRectangle(cornerRadius: Layout.cardCorner, style: .continuous)
                    .strokeBorder(Color(rgb: ground.tokens.gridLine), lineWidth: 1))
    }

    /// The quiet caps section header, the Rooms/Puzzles recipe (11pt semibold, tracked,
    /// the ground's number ink), so the three signed-in screens speak one label voice.
    private func sectionHeader(_ title: String) -> some View {
        Text(verbatim: title.uppercased())
            .font(.system(size: 11, weight: .semibold))
            .tracking(1.2)
            .foregroundStyle(Color(rgb: ground.tokens.number))
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The person: their puck (roster vocabulary), the name (or the plain fallback), and
    /// the provider line beneath, held in a paper card at the top like a profile header.
    /// Read from what auth state holds; no wire call.
    private var identityCard: some View {
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
        .padding(Layout.rowPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(cardBackground())
    }

    /// The solving preferences (personal-settings slice 1): two rows in one paper card,
    /// one grammar — a label and its one-line subtitle on the left, a native control on
    /// the right — divided by a hairline. Both write straight to the shared store, so the
    /// open room's cursor follows the change live.
    private var solvingCard: some View {
        VStack(spacing: 0) {
            settingRow(
                title: ArrivalCopy.settingsSkipFilledTitle,
                subtitle: ArrivalCopy.settingsSkipFilledSubtitle
            ) {
                Toggle("", isOn: $typingPrefs.skipFilledInWord)
                    .labelsHidden()
                    .tint(Color(rgb: ground.tokens.ink))
            }

            rowDivider

            settingRow(
                title: ArrivalCopy.settingsEndOfWordTitle,
                subtitle: ArrivalCopy.settingsEndOfWordSubtitle
            ) {
                // The picker's boolean maps first-blank/next-clue; the menu carries the
                // two short option labels the copy pins, so the collapsed value stays a
                // compact word (the store reads the tag back).
                Picker(
                    ArrivalCopy.settingsEndOfWordTitle,
                    selection: $typingPrefs.endOfWordIsNextClue
                ) {
                    Text(verbatim: ArrivalCopy.settingsEndOfWordNextClue).tag(true)
                    Text(verbatim: ArrivalCopy.settingsEndOfWordFirstBlank).tag(false)
                }
                .pickerStyle(.menu)
                .labelsHidden()
                .tint(Color(rgb: ground.tokens.number))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(cardBackground())
    }

    /// One preference row: title over subtitle on the left, the control trailing. The
    /// control is a @ViewBuilder so a toggle and a menu picker share one row frame and
    /// read as siblings, which the naked-controls v1 never did.
    private func settingRow(
        title: String,
        subtitle: String,
        @ViewBuilder control: () -> some View
    ) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: title)
                    .font(.system(size: 16))
                    .foregroundStyle(Color(rgb: ground.tokens.ink))
                Text(verbatim: subtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(Color(rgb: ground.tokens.number))
            }
            Spacer(minLength: 12)
            control()
        }
        .padding(.horizontal, Layout.rowPadding)
        .padding(.vertical, 12)
    }

    /// The hairline between rows: the `gridLine` token, inset to the label's leading edge
    /// (the iOS separator inset), so the divider reads as a rule inside the cell, not a
    /// second border.
    private var rowDivider: some View {
        Rectangle()
            .fill(Color(rgb: ground.tokens.gridLine))
            .frame(height: 1)
            .padding(.leading, Layout.rowPadding)
    }

    /// The two standing actions: sign out (a plain glass capsule) and delete (glass, but
    /// its label carries the destructive tone; the confirmation is the real gate). Both
    /// disable while a delete is in flight.
    private var actions: some View {
        VStack(spacing: 12) {
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

    /// The quiet legal pair, standing apart from the two capsule actions so it never
    /// reads as another account intent. Buttons, not Links: the composition root presents
    /// an in-app Safari sheet (the WelcomeScreen grammar), which keeps the person in the
    /// flow (App Review guideline 5.1.1) and is no dead end (the system sheet carries its
    /// own Done button and Safari chrome).
    private var legalRow: some View {
        HStack(spacing: 6) {
            legalButton(ArrivalCopy.privacyPolicy, page: .privacy)
            Text(verbatim: "·")
                .font(.system(size: 14))
                .foregroundStyle(Color(rgb: ground.tokens.number))
            legalButton(ArrivalCopy.termsOfService, page: .terms)
        }
    }

    private func legalButton(_ label: String, page: LegalPage) -> some View {
        Button {
            onOpenLegal(page)
        } label: {
            Text(verbatim: label)
                .font(.system(size: 14))
                .foregroundStyle(Color(rgb: ground.tokens.number))
        }
        .buttonStyle(.plain)
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

/// A throwaway store so a preview's toggles never persist into the shared defaults.
@available(iOS 17.0, macOS 14.0, *)
@MainActor
private func previewTypingPrefs() -> NavigationSettingsStore {
    NavigationSettingsStore(
        defaults: UserDefaults(suiteName: "preview.settings") ?? .standard)
}

#Preview("Account, Studio") {
    if #available(iOS 17.0, macOS 14.0, *) {
        SettingsScreen(
            identity: AccountIdentity(
                userId: "11111111-2222-3333-4444-555555555555",
                displayName: "Ada Lovelace",
                providerLabel: ArrivalCopy.providerDiscord),
            typingPrefs: previewTypingPrefs(),
            versionLabel: "1.0 (12)",
            onSignOut: {},
            onDeleteAccount: { nil },
            onOpenLegal: { _ in })
    }
}

#Preview("Account, no name, Observatory") {
    if #available(iOS 17.0, macOS 14.0, *) {
        SettingsScreen(
            identity: AccountIdentity(
                userId: "abcdef01-2345-6789-abcd-ef0123456789",
                displayName: nil,
                providerLabel: ArrivalCopy.providerApple),
            typingPrefs: previewTypingPrefs(),
            versionLabel: "1.0 (12)",
            onSignOut: {},
            onDeleteAccount: { ArrivalFailure(code: nil) },
            onOpenLegal: { _ in })
        .preferredColorScheme(.dark)
    }
}
