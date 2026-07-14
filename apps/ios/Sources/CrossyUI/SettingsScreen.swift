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
import CrossyProtocol
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
    /// Save a new display name (docs/design/name-onboarding.md §10): the composition root
    /// wraps `PATCH /me` and digests its result to a typed outcome, so the card keys the
    /// inline error on the code and adopts the canonical name on success. nil means the
    /// composition supplies no name editor (the harness identity, which has no /me to
    /// write): the identity row then stays read-only, exactly as before this feature.
    private let onSaveDisplayName: ((String) async -> DisplayNameOutcome)?
    /// Open a legal page (the WelcomeScreen grammar): the screen signals intent, the
    /// composition root maps it to the live page and presents the Safari sheet.
    private let onOpenLegal: (LegalPage) -> Void
    /// The personal reaction set (Wave 8.5; D25), the shared store the composition root
    /// also feeds the open room, so an edit here reaches the fan live. nil (the
    /// harness, a pre-8.5 composition) renders no Reactions section at all.
    private let reactionSets: ReactionSetStore?
    /// Save the set through `PATCH /me` (null resets), digested to the typed outcome
    /// the inline sentence keys on (the onSaveDisplayName shape). The composition root
    /// mirrors a `.saved` canonical value into the store; this screen only renders.
    private let onSaveReactionSet: (([String]?) async -> ReactionSetOutcome)?

    /// The per-device typing preferences (personal-settings slice 1), the shared store
    /// the composition root also feeds into the open room, so a change here reaches the
    /// cursor live. `@Bindable` so the toggle and picker write straight through.
    @Bindable private var typingPrefs: NavigationSettingsStore

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var confirmingDelete = false
    @State private var deleting = false
    @State private var deleteFailure: ArrivalFailure?
    // The identity card's inline name editor (§10). The current name lives here, seeded
    // from the composition root's /me-sourced identity, so a saved name updates the puck
    // and the row in place without a new AccountIdentity field. Editing flips the name
    // line from Text to a TextField in the same card; Save adopts the canonical value.
    @State private var currentName: String?
    @State private var editingName = false
    @State private var nameDraft = ""
    @State private var savingName = false
    @State private var nameErrorCode: String?
    @State private var nameHasError = false
    @FocusState private var nameFieldFocused: Bool
    // The identity puck is a live RosterPuckView, so its avatar layer reads a cache
    // from the environment (AvatarImage). This screen mounts outside the room, so it
    // owns its own instance; without one the puck would have no cache to load from and
    // stay the colored initial (its one puck makes a shared cache unnecessary).
    @State private var avatarCache = AvatarImageCache()
    // The Reactions slot editor (Wave 8.5; D25). One slot opens at a time; the draft
    // is the free-entry field's content, filtered through ReactionSetSpec; the save
    // spinner and the inline error key on the same states the name editor uses.
    @State private var editingReactionSlot: Int?
    @State private var reactionDraft = ""
    @State private var savingReactions = false
    @State private var reactionErrorCode: String?
    @State private var reactionHasError = false
    /// The gentle single-emoji rule, shown when typed input fails the local gate
    /// (distinct from a server error: nothing was judged, the field just explains).
    @State private var reactionRuleNudge = false

    /// The shared inset and card geometry, so the screen sits as a sibling of Rooms and
    /// Puzzles (both 16pt) and its cards echo the RoomCard silhouette (corner 16).
    private enum Layout {
        static let inset: CGFloat = 16
        static let cardCorner: CGFloat = 16
        static let rowPadding: CGFloat = 14
    }

    /// The quick-grid house picks (owner strawman 2026-07-14): the default five first,
    /// in slot order, then the crowd favorites, the retired Phase 7 three included.
    static let reactionHousePicks: [String] = [
        "🔥", "🤔", "🐐", "💀", "😭",
        "🎉", "👀", "🫡", "🤯", "❤️", "👏", "🧠", "🙏", "✨", "😤", "🥳",
    ]

    public init(
        identity: AccountIdentity,
        typingPrefs: NavigationSettingsStore,
        versionLabel: String? = nil,
        onSignOut: @escaping () -> Void,
        onDeleteAccount: @escaping () async -> ArrivalFailure?,
        onSaveDisplayName: ((String) async -> DisplayNameOutcome)? = nil,
        reactionSets: ReactionSetStore? = nil,
        onSaveReactionSet: (([String]?) async -> ReactionSetOutcome)? = nil,
        onOpenLegal: @escaping (LegalPage) -> Void
    ) {
        self.identity = identity
        self.typingPrefs = typingPrefs
        self.versionLabel = versionLabel
        self.onSignOut = onSignOut
        self.onDeleteAccount = onDeleteAccount
        self.onSaveDisplayName = onSaveDisplayName
        self.reactionSets = reactionSets
        self.onSaveReactionSet = onSaveReactionSet
        self.onOpenLegal = onOpenLegal
        // Seed the editable name from the composition root's identity (sourced from
        // /me). @State's initial value is honored only on first build, so the identity's
        // name is the source of truth on entry and `currentName` carries edits thereafter.
        _currentName = State(initialValue: identity.displayName)
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

                // The personal reaction set (Wave 8.5; D25): rendered only when the
                // composition supplies the store, the onSaveDisplayName gating idiom.
                if let reactionSets, onSaveReactionSet != nil {
                    sectionHeader(ArrivalCopy.settingsReactionsSection)
                        .padding(.top, 22)
                        .padding(.bottom, 8)
                    reactionsCard(reactionSets)
                }

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
        // The name arrives from /me possibly AFTER this tab first builds (the profile
        // load races the tab render): adopt a later-arriving name when not mid-edit, so
        // the row and puck fill in rather than staying on the seeded value. An edit in
        // flight is left alone; the composition root's own selfProfile is the truth a
        // successful save writes back, so this never fights a local edit.
        .onChange(of: identity.displayName) { _, newName in
            if !editingName { currentName = newName }
        }
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

    /// The identity as a roster member reflecting the LIVE edited name, so the puck's
    /// initial recomputes as the person types and after a save (§10). Reuses the account's
    /// id (color) and avatar; the name is the draft while editing, else the current name.
    private var liveRosterMember: RosterMember {
        RosterMember(
            userId: identity.userId,
            displayName: editingName ? nameDraft : (currentName ?? ""),
            wireColor: "",
            avatarUrl: identity.avatarUrl,
            isHost: false,
            isSpectator: false,
            connected: true)
    }

    /// The person: their puck (roster vocabulary), the name (or the plain fallback), and
    /// the provider line beneath, held in a paper card at the top like a profile header.
    /// The name line flips from Text to a TextField in place when editing (§10, inline
    /// edit, not a sheet), keeping the live puck to its left. The card is its own preview.
    private var identityCard: some View {
        HStack(alignment: editingName ? .top : .center, spacing: 14) {
            RosterPuckView(member: liveRosterMember, ground: ground, diameter: 52)
                // Swap the puck initial with no spring/cross-fade under Reduce Motion (§15).
                .animation(
                    reduceMotion ? nil : .crossyChrome,
                    value: editingName ? nameDraft : (currentName ?? ""))
            if editingName {
                nameEditor
            } else {
                nameDisplay
            }
            Spacer(minLength: 0)
        }
        .padding(Layout.rowPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(cardBackground())
    }

    /// The read state: the name (or the pre-onboarding fallback) over the provider line,
    /// with a trailing pencil that enters edit mode. The whole name line is tappable too,
    /// so the affordance is generous. Rendered when a name editor is supplied; without one
    /// (the harness) the row stays plain read-only, exactly as before this feature.
    private var nameDisplay: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(verbatim: currentName ?? ArrivalCopy.settingsNoName)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Color(rgb: ground.tokens.ink))
                if let providerLabel = identity.providerLabel {
                    Text(verbatim: providerLabel)
                        .font(.system(size: 14))
                        .foregroundStyle(Color(rgb: ground.tokens.number))
                }
            }
            if onSaveDisplayName != nil {
                Spacer(minLength: 8)
                Button {
                    beginEditingName()
                } label: {
                    Image(systemName: "pencil")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color(rgb: ground.tokens.number))
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(ArrivalCopy.settingsNameTitle)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { if onSaveDisplayName != nil { beginEditingName() } }
    }

    /// The edit state: a glass-surfaced TextField in the same card seeded from the current
    /// name, with a compact glass Save capsule and a Cancel ghost button, and an inline
    /// error line keyed on the §12 code (§10). The provider line stays beneath so the row
    /// grammar holds.
    private var nameEditor: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField(ArrivalCopy.displayNameFieldPrompt, text: $nameDraft)
                .textFieldStyle(.plain)
                .font(.system(size: 17))
                .foregroundStyle(Color(rgb: ground.tokens.ink))
                .submitLabel(.done)
                .focused($nameFieldFocused)
                .onChange(of: nameDraft) { _, new in
                    let clean = DisplayNameEntry.sanitize(new)
                    if clean != new { nameDraft = clean }
                }
                .onSubmit { Task { await saveName() } }
                #if os(iOS)
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                #endif
                .padding(.vertical, 12)
                .padding(.horizontal, 14)
                .modifier(ChromeGlassSurface(cornerRadius: 12))
                .accessibilityLabel(ArrivalCopy.settingsNameTitle)
                .accessibilityValue(
                    nameHasError
                        ? ArrivalCopy.displayNameError(forCode: nameErrorCode) : "")

            if nameHasError {
                Text(verbatim: ArrivalCopy.displayNameError(forCode: nameErrorCode))
                    .font(.system(size: 13))
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isStaticText)
            }

            HStack(spacing: 10) {
                saveNameCapsule
                Button(ArrivalCopy.settingsNameCancel) { cancelEditingName() }
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color(rgb: ground.tokens.number))
                    .buttonStyle(.plain)
                    .disabled(savingName)
                    .accessibilityLabel(ArrivalCopy.settingsNameCancel)
            }
        }
    }

    /// The compact glass Save capsule: the primary-action material, the capsule spinner
    /// during PATCH /me, disabled when the sanitized draft is empty.
    private var saveNameCapsule: some View {
        Button {
            Task { await saveName() }
        } label: {
            ZStack {
                Text(verbatim: ArrivalCopy.settingsNameSave)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color(rgb: ground.tokens.ink))
                    .opacity(savingName ? 0 : 1)
                if savingName {
                    ProgressView().tint(Color(rgb: ground.tokens.ink))
                }
            }
            .padding(.horizontal, 22)
            .frame(height: 40)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .modifier(ChromeGlassSurface(cornerRadius: 20))
        .opacity(canSaveName ? 1 : 0.4)
        .disabled(!canSaveName || savingName)
        .accessibilityLabel(ArrivalCopy.settingsNameSave)
    }

    private var canSaveName: Bool {
        !DisplayNameEntry.canonicalize(nameDraft).isEmpty
    }

    private func beginEditingName() {
        nameDraft = DisplayNameEntry.sanitize(currentName ?? "")
        nameErrorCode = nil
        nameHasError = false
        editingName = true
        nameFieldFocused = true
    }

    private func cancelEditingName() {
        editingName = false
        nameHasError = false
        nameErrorCode = nil
    }

    /// Save the edited name (§10): validate at the edge, call the injected save, adopt the
    /// canonical name and exit on success, show the inline error on a NAME_* / rate-limit
    /// rejection, keep the draft on a transient failure (retryable). Never a lockout.
    private func saveName() async {
        guard let onSaveDisplayName, canSaveName, !savingName else { return }
        savingName = true
        nameHasError = false
        nameErrorCode = nil
        defer { savingName = false }

        let canonical = DisplayNameEntry.canonicalize(nameDraft)
        switch await onSaveDisplayName(canonical) {
        case .saved(let stored):
            currentName = stored
            editingName = false
        case .nameRejected(let code):
            nameErrorCode = code
            nameHasError = true
        case .rateLimited:
            nameErrorCode = "RATE_LIMITED"
            nameHasError = true
        case .retryable(let code):
            nameErrorCode = code
            nameHasError = true
        }
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

    // MARK: - Reactions (Wave 8.5; PROTOCOL.md §9, §12, D25)

    /// The personal-set card: the five slots in slot order, an inline editor for the
    /// open slot (a quick grid of house picks plus a one-emoji field on the system
    /// emoji keyboard), and the reset-to-defaults affordance. Every change saves on
    /// pick through PATCH /me; a named 422 renders inline (the name editor's grammar).
    private func reactionsCard(_ store: ReactionSetStore) -> some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: ArrivalCopy.settingsReactionSetTitle)
                        .font(.system(size: 16))
                        .foregroundStyle(Color(rgb: ground.tokens.ink))
                    Text(verbatim: ArrivalCopy.settingsReactionSetSubtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(Color(rgb: ground.tokens.number))
                }

                HStack(spacing: 8) {
                    ForEach(Array(store.slots.enumerated()), id: \.offset) { index, emoji in
                        reactionSlotButton(index: index, emoji: emoji)
                    }
                }
            }
            .padding(Layout.rowPadding)

            if let slot = editingReactionSlot {
                rowDivider
                reactionSlotEditor(slot: slot, store: store)
            }

            rowDivider

            HStack(spacing: 10) {
                Button(ArrivalCopy.settingsReactionSetReset) {
                    Task { await saveReactionSet(nil) }
                }
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Color(rgb: ground.tokens.number))
                .buttonStyle(.plain)
                // Already on the defaults: nothing to reset (a null PATCH would be a
                // no-op write), so the affordance stands down rather than lying.
                .disabled(savingReactions || store.personal == nil)
                .opacity(store.personal == nil ? 0.4 : 1)
                .accessibilityLabel(ArrivalCopy.settingsReactionSetReset)

                Spacer(minLength: 0)

                if savingReactions {
                    ProgressView().tint(Color(rgb: ground.tokens.ink))
                }
            }
            .padding(.horizontal, Layout.rowPadding)
            .padding(.vertical, 12)

            if reactionHasError {
                Text(verbatim: ArrivalCopy.reactionSetError(forCode: reactionErrorCode))
                    .font(.system(size: 13))
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, Layout.rowPadding)
                    .padding(.bottom, 12)
                    .accessibilityAddTraits(.isStaticText)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(cardBackground())
    }

    /// One slot: its emoji in a hairlined square, the open slot carrying the ink ring.
    /// Tapping opens (or closes) that slot's editor; edits land through the editor.
    private func reactionSlotButton(index: Int, emoji: String) -> some View {
        let selected = editingReactionSlot == index
        return Button {
            if selected {
                closeReactionEditor()
            } else {
                editingReactionSlot = index
                reactionDraft = ""
                reactionRuleNudge = false
                reactionHasError = false
                reactionErrorCode = nil
            }
        } label: {
            Text(verbatim: emoji)
                .font(.system(size: 26))
                .frame(maxWidth: .infinity)
                .frame(height: 48)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Color(rgb: ground.tokens.ink).opacity(selected ? 0.08 : 0)))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(
                            selected
                                ? Color(rgb: ground.tokens.ink).opacity(0.55)
                                : Color(rgb: ground.tokens.gridLine),
                            lineWidth: 1))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(savingReactions)
        .accessibilityLabel(Text(verbatim: "Slot \(index + 1): \(emoji)"))
    }

    /// The open slot's editor: the house-pick quick grid, then the free-entry field
    /// whose input surface is the system emoji keyboard (EmojiKeyboardField), filtered
    /// through the spec so only one emoji can land. A failed keystroke shows the
    /// gentle rule, never an error tone: nothing was judged, the field just explains.
    private func reactionSlotEditor(slot: Int, store: ReactionSetStore) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            let columns = Array(
                repeating: GridItem(.flexible(), spacing: 6), count: 8)
            LazyVGrid(columns: columns, spacing: 6) {
                ForEach(Self.reactionHousePicks, id: \.self) { pick in
                    Button {
                        applyReactionPick(pick, slot: slot, store: store)
                    } label: {
                        Text(verbatim: pick)
                            .font(.system(size: 24))
                            .frame(maxWidth: .infinity)
                            .frame(height: 40)
                            .background(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .fill(Color(rgb: ground.tokens.ink).opacity(0.05)))
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(savingReactions)
                    .accessibilityLabel(Text(verbatim: "Use \(pick)"))
                }
            }

            reactionEntryField(slot: slot, store: store)
                .padding(.vertical, 8)
                .padding(.horizontal, 14)
                .modifier(ChromeGlassSurface(cornerRadius: 12))

            if reactionRuleNudge {
                Text(verbatim: ArrivalCopy.settingsReactionRule)
                    .font(.system(size: 13))
                    .foregroundStyle(Color(rgb: ground.tokens.number))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isStaticText)
            }
        }
        .padding(Layout.rowPadding)
    }

    /// The one-emoji field: the system emoji keyboard on iOS (the UIKit input-mode
    /// hook), a plain field on the macOS test host. Both feed the same filter.
    @ViewBuilder
    private func reactionEntryField(slot: Int, store: ReactionSetStore) -> some View {
        #if os(iOS)
            EmojiKeyboardField(
                text: $reactionDraft, placeholder: ArrivalCopy.settingsReactionFieldPrompt
            )
            .frame(height: 32)
            .accessibilityLabel(ArrivalCopy.settingsReactionFieldLabel)
            .onChange(of: reactionDraft) { old, new in
                filterReactionDraft(from: old, to: new, slot: slot, store: store)
            }
        #else
            TextField(ArrivalCopy.settingsReactionFieldPrompt, text: $reactionDraft)
                .textFieldStyle(.plain)
                .font(.system(size: 22))
                .accessibilityLabel(ArrivalCopy.settingsReactionFieldLabel)
                .onChange(of: reactionDraft) { old, new in
                    filterReactionDraft(from: old, to: new, slot: slot, store: store)
                }
        #endif
    }

    /// The field's validator gate: a valid single emoji applies to the slot at once
    /// (save on change); more than one grapheme keeps only the newest, so tapping a
    /// second emoji swaps rather than appends; anything else is filtered back out and
    /// the gentle rule shows. Assigning `reactionDraft` here re-enters this observer,
    /// which the old-value comparisons make a no-op.
    private func filterReactionDraft(
        from old: String, to new: String, slot: Int, store: ReactionSetStore
    ) {
        guard new != old else { return }
        if new.isEmpty {
            reactionRuleNudge = false
            return
        }
        if ReactionSetSpec.isReactionEmoji(new) {
            reactionRuleNudge = false
            applyReactionPick(new, slot: slot, store: store)
            return
        }
        // Keep the newest grapheme when it stands alone as one emoji (the keyboard
        // appends; the field swaps). Everything else filters out with the rule shown.
        let newest = String(new.suffix(1))
        if new.count > 1, ReactionSetSpec.isReactionEmoji(newest) {
            reactionDraft = newest
            reactionRuleNudge = false
            applyReactionPick(newest, slot: slot, store: store)
        } else {
            reactionDraft = old
            reactionRuleNudge = true
        }
    }

    /// One slot changes: build the candidate five, gate locally with the spec (so a
    /// duplicate names its rule without a round trip; the server stays the authority),
    /// and save through PATCH /me. A pick equal to the standing emoji just closes.
    private func applyReactionPick(_ emoji: String, slot: Int, store: ReactionSetStore) {
        var candidate = store.slots
        guard candidate.indices.contains(slot) else { return }
        if candidate[slot] == emoji {
            closeReactionEditor()
            return
        }
        candidate[slot] = emoji
        if let violation = ReactionSetSpec.validate(candidate) {
            reactionErrorCode = violation.rawValue
            reactionHasError = true
            return
        }
        Task { await saveReactionSet(candidate) }
    }

    /// The one write path (PATCH /me; nil resets to the defaults). On success the
    /// composition root has mirrored the canonical set into the store, so the slots
    /// re-render themselves and the open fan follows live; the editor closes. A named
    /// 422 or the rate limit renders inline and the edit stays standing (retryable).
    private func saveReactionSet(_ set: [String]?) async {
        guard let onSaveReactionSet, !savingReactions else { return }
        savingReactions = true
        reactionHasError = false
        reactionErrorCode = nil
        reactionRuleNudge = false
        defer { savingReactions = false }

        switch await onSaveReactionSet(set) {
        case .saved:
            closeReactionEditor()
        case .rejected(let code):
            reactionErrorCode = code
            reactionHasError = true
        case .rateLimited:
            reactionErrorCode = "RATE_LIMITED"
            reactionHasError = true
        case .retryable(let code):
            reactionErrorCode = code
            reactionHasError = true
        }
    }

    private func closeReactionEditor() {
        editingReactionSlot = nil
        reactionDraft = ""
        reactionRuleNudge = false
        reactionHasError = false
        reactionErrorCode = nil
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

/// The reactions twin: a throwaway personal-set store off the shared defaults.
@available(iOS 17.0, macOS 14.0, *)
@MainActor
private func previewReactionSets() -> ReactionSetStore {
    ReactionSetStore(defaults: UserDefaults(suiteName: "preview.settings") ?? .standard)
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
            onSaveDisplayName: { name in .saved(canonical: name) },
            reactionSets: previewReactionSets(),
            onSaveReactionSet: { set in .saved(set) },
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
