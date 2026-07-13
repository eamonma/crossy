//
//  ArrivalRootView.swift
//  Crossy
//
//  The end-to-end journey's spine (EXPERIENCE.md §2): signed out shows Welcome;
//  signed in shows the shell — the system tab bar carrying the three stable places
//  (Rooms, Puzzles, Settings), mirroring the web's destinations. The bar is the
//  system's: Liquid Glass on iOS 26+ by adoption, the plain material bar on the 18
//  floor, never a hand-built imitation (DESIGN.md §4). Join with a code opens a
//  glass sheet that flows out of the button (arrival notes, DESIGN.md §4); a joined
//  or tapped room pushes inside the Rooms tab and hides the bar — the board and
//  deck own the whole screen (the full-bleed ruling). A tapped room card grows the
//  room out of that card via the system zoom navigation transition, and the pop
//  pours it back into the card (native continuity, DESIGN.md §4). Join success
//  sequences the same read: the sheet melts back into the Join capsule first, then
//  the room grows out of the capsule; the room is still the only pushed element, so
//  back from the room lands on Rooms, never on a stale code field. The kicked exit
//  (SolveScreen onExit) pops home the same way.
//

import CrossyDesign
import CrossyUI
import SwiftUI

/// Everything the arrival flow can push. Join is a sheet now, not a push, so it is
/// no longer a route: the room is the only thing the join lands.
enum ArrivalRoute: Hashable {
    case room(gameId: String)
    /// The -i3Fixture composition's room: the loopback DemoRoom, no network.
    case fixtureRoom
}

/// The signed-in shell's three places. `-i3Tab puzzles|settings` selects the
/// starting tab (fixture demos and screenshots of a specific place; absent or
/// unrecognized lands on Rooms, the home).
enum ShellTab: Hashable {
    case rooms, puzzles, settings

    static var launchSelection: ShellTab {
        switch LaunchFacts.value("i3Tab") {
        case "puzzles": return .puzzles
        case "settings": return .settings
        default: return .rooms
        }
    }
}

struct ArrivalRootView: View {
    @State private var model = ArrivalModel.resolve()
    @State private var path: [ArrivalRoute] = []
    /// The Puzzles tab's own navigation path: starting a game from a puzzle pushes
    /// the created room inside this tab, the same way an opened room card pushes
    /// inside Rooms. A per-tab path keeps a room started from Puzzles landing back on
    /// Puzzles, and its own tab bar hides while the room is up (the full-bleed ruling).
    @State private var puzzlesPath: [ArrivalRoute] = []
    /// The join sheet's presentation state and its zoom namespace. The namespace
    /// lives here, not in RoomsScreen, because the sheet is presented from this
    /// hierarchy; the button downstream stamps itself as the matching source.
    /// `-i3Join` opens it at launch (fixture demos and screenshots of the panel).
    @State private var showJoin = LaunchFacts.flag("i3Join")
    /// The camera's standing on this device, resolved when the join sheet rises
    /// (CameraScanAuthority; the simulator resolves denied, the panel keeps its
    /// typed path).
    @State private var joinScan: JoinScanState = .probing
    /// A Universal Link's code, when a direct join failed: the join sheet opens
    /// pre-filled with it (code-only, no camera probe) so the reason is one tap
    /// away. Empty for a hand-tapped Join, which gets the camera-first panel.
    @State private var deepLinkPrefill = ""
    @State private var tab: ShellTab = .launchSelection
    /// The legal page a footer button staged (Welcome and Settings each present
    /// from their own context): one Safari sheet per context, the URL resolved
    /// from the model's web-origin facts.
    @State private var welcomeLegal: LegalSheetItem?
    @State private var settingsLegal: LegalSheetItem?
    /// The source id that initiated the room currently being pushed (native
    /// continuity, DESIGN.md §4): a tapped card's per-room id, or the Join capsule's
    /// id on a code-join. The room destination zooms from this source, so the room
    /// grows out of the surface it was launched from and pours back into it on the
    /// pop. Deliberately never cleared on the pop: the path empties at the START of
    /// the pop (the tab-bar note below), so clearing on emptiness would flip the
    /// zoom modifier's branch and restructure the exiting room mid-animation, the
    /// very snap this zoom exists to avoid. Staleness is handled at the source
    /// instead: every push site assigns it (a card tap its card's id, a code-join
    /// the capsule's, a deep link nil for the default push, there being no visible
    /// source on screen), so no push ever inherits a stale id. Sign-out resets it
    /// with the paths. NOTE: Puzzles-tab pushes stay default (no zoom) in this PR;
    /// the puzzle card as a zoom source is a follow-up.
    @State private var roomZoomSourceID: String?
    /// The tapped card's true facts, recorded beside the path at tap time (the
    /// seeded-birth rule, DESIGN.md §4, §12), keyed by gameId exactly as
    /// `roomZoomSourceID` is: a card tap records its member stack and invite code, so
    /// the pushed room is born identity-true and the goo plays on live data. A deep
    /// link or a code-join records nothing (no card), so its room reads nil here and
    /// keeps the one-beat arrival. Cleared on sign-out with the paths and the zoom
    /// source (the room's card is gone). Keyed rather than single-slotted because two
    /// pushes can be staged in the two navigating tabs, and a stale seed must never
    /// dress the wrong room.
    @State private var roomSeeds: [String: RoomArrivalSeed] = [:]
    /// A code-join staged for after the sheet melts back into the Join capsule
    /// (slice 2): join success dismisses the sheet, and the room pushes only when
    /// the sheet's dismissal completes (the sheet's .onDisappear), so the read is
    /// the sheet pouring into the capsule, then the room growing out of it.
    @State private var pendingJoinGameId: String?
    @Namespace private var joinZoom
    /// The room push's zoom namespace, distinct from the join sheet's: room cards
    /// and the Join capsule stamp themselves as sources here, and the room
    /// destination zooms from the matching source. The namespace lives here, not in
    /// RoomsScreen, because the push lives in this hierarchy (AD-2, mirroring the
    /// join sheet's namespace ownership).
    @Namespace private var roomZoom
    /// The per-device typing settings (personal-settings slice 1), owned here so both
    /// the Settings tab that edits them and every room that reads them share one store;
    /// a change in Settings reaches an open room live (SelectionModel re-reads the prefs
    /// closure on each keystroke). Persisted in UserDefaults, off the wire entirely.
    @State private var typingPrefs = NavigationSettingsStore()
    /// Display-name onboarding (docs/design/name-onboarding.md §9): on entering the
    /// signed-in shell the composition root reads `/me`; a nameless permanent account
    /// (`needsName`) gates the shell behind a light scrim and presents the onboarding sheet
    /// until a name lands. `onboardingChecked` guards the one-shot per sign-in so a
    /// re-render never re-runs the read; it resets on sign-out. The model is built when the
    /// sheet is armed, carrying the prefill and the resilient submit (R4).
    @State private var onboardingChecked = false
    @State private var showNameOnboarding = false
    @State private var onboardingModel: DisplayNameOnboardingModel?
    @Environment(\.colorScheme) private var colorScheme
    /// The invite a Universal Link delivered (CrossyApp set it via InviteScan).
    @Environment(PendingInvite.self) private var pendingInvite
    /// The magic link a Universal Link delivered (CrossyApp set it via AuthConfirm,
    /// roadmap I3b): completed against the session here, the PendingInvite precedent.
    @Environment(PendingMagicLink.self) private var pendingMagicLink
    /// The analytics port CrossyApp built (the noop in every rig composition, so
    /// nothing here checks). Identify and signed_in live on this view because it is
    /// the one observer of the session phase; the seam the routing already reads.
    @Environment(\.analytics) private var analytics

    var body: some View {
        Group {
            if model.isSignedIn {
                signedInShell
                    // A light scrim gates the shell content while a nameless account is
                    // onboarding (§9.1), so the goal (always a name) holds; it clears the
                    // instant a name lands and the sheet dismisses. Only visible while the
                    // onboarding sheet is up.
                    .overlay {
                        if showNameOnboarding {
                            Color.black.opacity(0.18).ignoresSafeArea()
                                .allowsHitTesting(true)
                        }
                    }
                    // The one onboarding read per sign-in: on entering the shell, load
                    // /me; if the account is nameless, arm the sheet. INV-11: this runs
                    // only on a true signed-in session (the shell is shown), and a
                    // transient read failure retries with backoff rather than presenting
                    // onboarding on a maybe or signing out. Keyed on the user id so a
                    // re-sign-in as a different account re-checks.
                    .task(id: model.session.userId) { await checkOnboarding() }
                    .sheet(isPresented: $showNameOnboarding) {
                        if let onboardingModel, let userId = model.session.userId {
                            DisplayNameOnboardingSheet(
                                ground: ground,
                                userId: userId,
                                avatarUrl: model.selfProfile?.avatarUrl,
                                model: onboardingModel)
                        }
                    }
            } else {
                WelcomeScreen(
                    state: model.welcomeState,
                    onContinueApple: { Task { await model.session.signInWithApple() } },
                    onContinueDiscord: { Task { await model.session.signIn() } },
                    // The secondary methods (roadmap I3b): hisbaan rides the web leg
                    // like Discord, the email pair is the sheet's own OTP flow. Their
                    // completion flips the phase to signed in exactly as the primary
                    // buttons do, so the shell swaps in without any extra wiring here.
                    onContinueHisbaan: { Task { await model.session.continueWithHisbaan() } },
                    // The email OTP send mints an invisible Turnstile token first, then
                    // sends with it (Supabase has captcha on project-wide, so a send
                    // without a token is refused). When this build carries no site key
                    // (the fixture/unconfigured paths, or an empty plist slot) the token
                    // step is skipped and the send carries nil, exactly the pre-captcha
                    // behavior. A token-acquisition failure throws, which the sheet
                    // renders as the calm send-failure sentence.
                    sendEmailOTP: { email in
                        let token = try await captchaTokenIfNeeded()
                        try await model.session.sendEmailOTP(email: email, captchaToken: token)
                    },
                    verifyEmailOTP: { email, code in
                        try await model.session.verifyEmailOTP(email: email, code: code)
                    },
                    onOpenLegal: { welcomeLegal = legalItem(for: $0) },
                    // The hidden captcha web view, only when this build has a site key.
                    // Type-erased so CrossyUI never sees WebKit; it renders nothing until
                    // a forced interactive challenge reveals it in place.
                    captchaView: {
                        if model.turnstile.siteKey != nil {
                            AnyView(TurnstileCaptchaView(provider: model.turnstile))
                        } else {
                            AnyView(EmptyView())
                        }
                    }
                )
                .sheet(item: $welcomeLegal) { item in
                    SafariSheet(url: item.url)
                        .ignoresSafeArea()
                }
            }
        }
        .sheet(isPresented: $showJoin) {
            joinSheet
        }
        // A cold launch straight from an invite link, already signed in: the code
        // is set before this view's observers register, so honor it once on appear.
        // A restored session is likewise already signed in before this view exists,
        // so the standing user is identified here; signed_in stays reserved for the
        // observed transition below, never a relaunch or resume of a standing session.
        .task {
            if let userId = model.session.userId { analytics.identify(userId: userId) }
            honorPendingInvite()
            // A cold launch straight from a magic link: the link is set before this
            // view's observers register (the invite's cold-launch reasoning), so
            // complete it once on appear. AuthSession no-ops it when already signing in.
            completePendingMagicLink()
        }
        // A link arriving while the app runs.
        .onChange(of: pendingInvite.code) { honorPendingInvite() }
        .onChange(of: pendingMagicLink.link) { completePendingMagicLink() }
        .onChange(of: model.isSignedIn) { _, signedIn in
            if signedIn {
                // The one transition into signed in: an interactive sign-in
                // completing (a restored session never passes here). The person
                // becomes known and the shared-vocabulary event fires exactly once
                // per sign-in, matching web and server funnels.
                if let userId = model.session.userId { analytics.identify(userId: userId) }
                analytics.capture("signed_in")
                // Sign-in completed: honor an invite that was held while signed out
                // (the held-invite promise, EXPERIENCE.md §3).
                honorPendingInvite()
            } else {
                // Sign-out, deletion, or a terminal refresh refusal: the identity is
                // no longer standing, so analytics forgets it too.
                analytics.reset()
                // Sign-out or deletion drops the shell; a stale pushed room (in
                // either navigating tab) or a live join sheet must not greet the next
                // sign-in.
                path.removeAll()
                puzzlesPath.removeAll()
                showJoin = false
                // The Rooms path is empty now, so the zoom source, the recorded seeds,
                // and a staged join are stale: clear them with the paths (the room's
                // card is gone).
                roomZoomSourceID = nil
                roomSeeds.removeAll()
                pendingJoinGameId = nil
                // Onboarding is per sign-in: drop the sheet and re-arm the one-shot so the
                // next sign-in (possibly a different, nameless account) checks /me afresh.
                showNameOnboarding = false
                onboardingModel = nil
                onboardingChecked = false
                model.selfProfile = nil
                // The selected tab is shell state too, and it survives the sign-out
                // because this view (and its `tab` @State) outlives the shell, only its
                // body swaps to Welcome. Sign-out happens FROM the Settings tab, so
                // without this reset the next sign-in restores Settings instead of the
                // home. Return it to the launch default (Rooms, absent an -i3Tab rig
                // fact), the same value this view initializes `tab` to, so a re-entry
                // always lands home.
                tab = .launchSelection
            }
        }
        // The pre-fill is a one-shot for a failed deep link; a later hand-tapped
        // Join must open the camera-first panel, never a stale code.
        .onChange(of: showJoin) { _, open in
            if !open { deepLinkPrefill = "" }
        }
    }

    /// The invisible Turnstile token the OTP send needs, or nil when this build carries
    /// no site key (the fixture/unconfigured paths, or an empty plist slot): the send then
    /// runs with no token, the pre-captcha behavior. When a key is present this drives the
    /// hidden web view to mint a fresh single-use token (a challenge reveals itself in the
    /// sheet if Turnstile forces one); a failure throws, which the sheet renders as the
    /// calm send-failure sentence.
    private func captchaTokenIfNeeded() async throws -> String? {
        guard model.turnstile.siteKey != nil else { return nil }
        return try await model.turnstile.token()
    }

    /// The one onboarding read per sign-in (§9.1). Read /me with a bounded backoff retry;
    /// present the sheet iff the server reports `needsName` (R3: the trigger is the
    /// server's own answer, no client policy). INV-11: armed only by a true signed-in
    /// session (this runs inside the shell), never by a transient failure; a failed read
    /// retries a few times and then gives up quietly (the next shell entry re-checks),
    /// never signing out. Guarded so a re-render never re-onboards mid-session.
    private func checkOnboarding() async {
        guard model.session.userId != nil, !onboardingChecked else { return }
        onboardingChecked = true

        // Bounded backoff: a brand-new email sign-up hits /me the instant the shell
        // appears, so a blip must not skip onboarding. A handful of tries is plenty; if
        // all fail, the account is still nameless on the next entry and re-checks.
        var attempt = 0
        while attempt < 4 {
            if let loaded = await model.loadSelfProfile() {
                if loaded.needsName, let userId = model.session.userId {
                    armOnboarding(userId: userId)
                }
                return
            }
            attempt += 1
            try? await Task.sleep(for: .seconds(Double(attempt) * 0.6))
        }
    }

    /// Build the onboarding model (the prefill + the resilient submit) and present the
    /// sheet. The submit rides the model's digested /me write; on a confirmed save the
    /// name is adopted into selfProfile (so Settings shows it) and the sheet dismisses.
    private func armOnboarding(userId: String) {
        onboardingModel = DisplayNameOnboardingModel(
            prefill: model.onboardingPrefill(for: userId),
            submit: { name in await model.setDisplayName(name) },
            onSaved: { _ in
                // The name landed (the model already adopted it into selfProfile); drop
                // the scrim and the sheet, revealing the shell.
                showNameOnboarding = false
                onboardingModel = nil
            })
        showNameOnboarding = true
    }

    /// Honor a Universal Link's invite code. Signed in: join at once and push the
    /// room — the QR's whole point, scan the projector and land in the room. A rare
    /// failure (the room ended, or the host removed you) opens the join panel
    /// pre-filled with the code, so the reason is one tap away and never silent.
    /// Signed out: the code stays pending until sign-in flips (this runs again on
    /// that edge). Cleared on consumption, so it fires exactly once.
    private func honorPendingInvite() {
        guard model.isSignedIn, let code = pendingInvite.code else { return }
        pendingInvite.code = nil
        Task {
            switch await model.rooms.join(code: code) {
            case .success(let gameId):
                showJoin = false
                // A deep link has no visible source on screen (the Join capsule may
                // never have shown, and no card was tapped), so the room takes the
                // default push: name no zoom source (native continuity, DESIGN.md §4).
                roomZoomSourceID = nil
                // The room pushes into the Rooms tab's own NavigationStack (`path`),
                // which the TabView renders only while Rooms is the selected tab. A scan
                // foregrounds the app wherever it stood: the system Camera's QR banner
                // opens the link from any tab, commonly Settings or Puzzles. So select
                // Rooms before the push. Without this the room lands in a hidden stack
                // and the scan reads as doing nothing (the reported bug).
                tab = .rooms
                path = [roomRoute(for: gameId)]
            case .failure:
                deepLinkPrefill = code
                showJoin = true
            }
        }
    }

    /// Complete a magic link a Universal Link delivered (roadmap I3b): hand its
    /// token_hash and type to the session, which drives the same signed-in outcome the
    /// email OTP and the primary buttons do (the shell swaps in through the phase alone).
    /// Cleared on consumption so it fires exactly once. A verify failure is swallowed
    /// here: the session lands in .failed, and Welcome already shows the plain retry for
    /// that phase, so a second surface would only double the message. Already signing in
    /// (a code entry in flight) makes completeMagicLink a no-op, which is the honest
    /// outcome.
    private func completePendingMagicLink() {
        guard let link = pendingMagicLink.link else { return }
        pendingMagicLink.link = nil
        Task {
            try? await model.session.completeMagicLink(
                tokenHash: link.tokenHash, type: link.type)
        }
    }

    /// The signed-in shell: three tabs, named by their places. Rooms and Puzzles both
    /// navigate (a room pushes inside whichever list opened it, each with its own
    /// path); Settings is a single page.
    private var signedInShell: some View {
        TabView(selection: $tab) {
            Tab(ArrivalCopy.roomsTitle, systemImage: "house", value: ShellTab.rooms) {
                NavigationStack(path: $path) {
                    RoomsScreen(
                        loadPage: { before in await model.rooms.loadPage(before: before) },
                        onOpenRoom: { room in
                            // The tapped card is the push's zoom source: name it
                            // BEFORE appending, so the room grows out of this card
                            // and pours back into it on the pop (native continuity,
                            // DESIGN.md §4). The id matches the card's stamp exactly.
                            roomZoomSourceID = RoomZoomSource.sourceID(for: room.gameId)
                            // Record the card's true facts beside the path (the
                            // seeded-birth rule, DESIGN.md §4, §12): its member stack
                            // and invite code seed the room identity-true, so the
                            // players and share pills stand from the push's first
                            // frame and the goo plays on live data. Keyed by gameId,
                            // read at construction, cleared on sign-out.
                            roomSeeds[room.gameId] = RoomArrivalSeed(
                                members: room.members, inviteCode: room.inviteCode,
                                completedAt: room.completedAt,
                                abandonedAt: room.abandonedAt)
                            path.append(roomRoute(for: room.gameId))
                        },
                        onJoinWithCode: { showJoin = true },
                        joinSheetSource: JoinSheetSource(namespace: joinZoom),
                        roomZoomSource: RoomZoomSource(namespace: roomZoom),
                        // The evidence walk (-i3AutoOpen): the first loaded room
                        // opens through the production tap seam, so a headless
                        // capture can watch the seeded birth and the goo against
                        // a live stack. Evidence only, false on every real path.
                        autoOpenFirstRoom: LaunchFacts.flag("i3AutoOpen")
                    )
                    // The Rooms nav bar is VISIBLE but title-less now (the
                    // toolbar-adoption ruling, DESIGN.md §4): the screen keeps
                    // its in-content 32pt "Rooms" title, and the bar carries only
                    // the Join item, which goos into the room's trailing cluster
                    // across the #132 zoom push. An empty inline title claims the
                    // strip without a system title fighting the hand-set one.
                    .navigationTitle("")
                    .navigationBarTitleDisplayMode(.inline)
                    .navigationDestination(for: ArrivalRoute.self) { route in
                        // Only the Rooms tab zooms: the room grows out of the card
                        // (or the Join capsule) that launched it. The zoom is applied
                        // here, at the Rooms call site, so a Puzzles-tab push (the
                        // shared destination reused there) never inherits a Rooms
                        // source id (native continuity, DESIGN.md §4). A nil id (a
                        // deep-link push) skips the zoom for a default push.
                        destination(route, pop: { path.removeAll() })
                            .roomZoom(
                                from: RoomZoomSource(namespace: roomZoom),
                                sourceID: roomZoomSourceID)
                            // A deep-link / QR push names no zoom source (roomZoomSourceID
                            // nil), so roomZoom falls back to a plain push and the hidden
                            // back button leaves the interactive pop disabled, the same
                            // bug as the Puzzles tab. Re-enable it exactly there; a card
                            // or Join-capsule push (non-nil source) keeps the zoom
                            // transition's own pop and must not be touched.
                            .background {
                                if roomZoomSourceID == nil { InteractivePopEnabler() }
                            }
                    }
                }
                // The room owns the whole screen (the full-bleed ruling), so the bar
                // hides while anything is pushed. Keyed off the path, NOT attached to
                // the pushed room: attaching `.toolbar(.hidden, for: .tabBar)` to the
                // destination broke the FIRST push per process (the nav bar's items and
                // the interactive-pop gesture both failed to materialize until a
                // re-push warmed them, owner report 2026-07-12); keying off the path
                // here has no such race, and the path empties at the start of a button
                // pop so the bar rides that animation.
                .toolbar(path.isEmpty ? .visible : .hidden, for: .tabBar)
            }
            Tab(ArrivalCopy.puzzlesTitle, systemImage: "squareshape.split.3x3", value: ShellTab.puzzles) {
                NavigationStack(path: $puzzlesPath) {
                    PuzzlesScreen(
                        loadPage: { before in await model.puzzles.loadPage(before: before) },
                        startGame: { puzzle in
                            await model.puzzles.startGame(puzzleId: puzzle.puzzleId)
                        },
                        onOpenRoom: { gameId in
                            puzzlesPath.append(roomRoute(for: gameId))
                        })
                    // The list draws its own big "Puzzles" title, so the system
                    // navigation bar stays hidden (the RoomsScreen pattern); the room
                    // hides its own bar in the destination.
                    .toolbar(.hidden, for: .navigationBar)
                    .navigationDestination(for: ArrivalRoute.self) { route in
                        // The Puzzles push is a plain push (no zoom transition to keep
                        // the interactive pop alive) and the room hides the back button,
                        // so the left-edge swipe-back is disabled by default. Re-enable
                        // it here (owner report 2026-07-13); the Rooms tab does not need
                        // this, its zoom push already keeps the pop.
                        destination(route, pop: { puzzlesPath.removeAll() })
                            .background(InteractivePopEnabler())
                    }
                }
                // The room owns the whole screen (the full-bleed ruling); the bar
                // hides while a room started here is pushed, keyed off this tab's own
                // path exactly as Rooms keys off its own (and for the same first-push
                // reason: never attached to the destination).
                .toolbar(puzzlesPath.isEmpty ? .visible : .hidden, for: .tabBar)
            }
            Tab(ArrivalCopy.settingsTitle, systemImage: "gearshape", value: ShellTab.settings) {
                settingsTab
            }
        }
        // The selected tab wears ink, not the system blue: chrome stays achromatic
        // (people and the destructive tone are the only color, DESIGN.md §1).
        .tint(Color(rgb: ground.tokens.ink))
    }

    /// The join surface: a glass sheet grown from the Join capsule, camera-first
    /// with the typed path always beneath (DESIGN.md §4). Success dismisses the
    /// sheet and makes the room the sole pushed element (the old push replaced
    /// the join route on the path; the sheet replaces that step exactly), so back
    /// from the room is Rooms, never a stale code field. The camera's standing
    /// resolves as the sheet rises; scanning works in every composition (a
    /// payload is digested locally), the fixture just stubs where the join goes.
    private var joinSheet: some View {
        // A failed deep link opens this pre-filled and code-only (scanState .none):
        // a tapped invite must never trigger a camera prompt. A hand-tapped Join is
        // the camera-first panel.
        let prefilled = !deepLinkPrefill.isEmpty
        return JoinCodeScreen(
            scanState: prefilled ? .none : joinScan,
            initialCode: deepLinkPrefill,
            onJoin: { code in
                switch await model.rooms.join(code: code) {
                case .success(let gameId):
                    // Sequence the continuity (slice 2, DESIGN.md §4): dismiss the
                    // sheet first so it melts back into the Join capsule, and stage
                    // the room. The room pushes only when the dismissal completes
                    // (the .onDisappear below), growing out of that same capsule.
                    // Setting both in one beat would push while the sheet is still
                    // mid-dismiss, and the room would jolt over the melting sheet.
                    pendingJoinGameId = gameId
                    showJoin = false
                    return nil
                case .failure(let failure):
                    return failure
                }
            }
        ) { onScan in
            CameraScanView(onScan: onScan)
        }
        // The screen owns its detents now, because it owns the focus that raises
        // them: focusing the field lifts the camera-first panel so the compact
        // live strip and the field clear the keyboard (camera stays live under the
        // keyboard, owner ruling). The drag indicator and the zoom source stay
        // here, where the sheet is presented.
        .presentationDragIndicator(.visible)
        .joinSheetZoom(from: JoinSheetSource(namespace: joinZoom))
        // The dismissal's completion hook (slice 2): when the sheet has fully melted
        // back into the Join capsule, push the staged room so it grows out of that
        // same capsule (native continuity, DESIGN.md §4). Naming the capsule as the
        // zoom source pairs the push to the capsule the sheet just poured into. A
        // hand dismiss (no join) stages nothing, so this is a no-op there.
        .onDisappear {
            guard let gameId = pendingJoinGameId else { return }
            pendingJoinGameId = nil
            roomZoomSourceID = RoomZoomSource.joinCapsuleID
            path = [roomRoute(for: gameId)]
        }
        .task {
            // The pre-filled failure card scans nothing, so it never probes the
            // camera (no permission prompt on a tapped link).
            guard !prefilled else { return }
            joinScan = .probing
            joinScan = await CameraScanAuthority.resolve() ? .live : .denied
        }
    }

    /// The Settings tab (roadmap I3, thin settings). Sign out and a confirmed delete
    /// both flip the session phase to signed out, so the shell itself swaps to
    /// Welcome; a delete failure renders inline on the screen and stays retryable.
    /// The harness identity (an injected token) carries no display facts, so its tab
    /// is a quiet canvas rather than an invented person.
    @ViewBuilder
    private var settingsTab: some View {
        if let identity = model.selfIdentity {
            SettingsScreen(
                identity: identity,
                typingPrefs: typingPrefs,
                versionLabel: model.versionLabel,
                onSignOut: {
                    Task { await model.session.signOut() }
                },
                onDeleteAccount: {
                    await model.session.deleteAccount()
                },
                // The inline name editor (§10): PATCH /me digested to the typed outcome the
                // card keys on. On success the model adopts the canonical name into
                // selfProfile too, so the identity stays consistent across the tab.
                onSaveDisplayName: { name in await model.setDisplayName(name) },
                onOpenLegal: { settingsLegal = legalItem(for: $0) })
                .sheet(item: $settingsLegal) { item in
                    SafariSheet(url: item.url)
                        .ignoresSafeArea()
                }
        } else {
            Color(rgb: ground.tokens.canvas).ignoresSafeArea()
        }
    }

    /// Map a screen's legal intent to the model's URL (the screens hold no URLs,
    /// AD-2); the item's identity is that URL.
    private func legalItem(for page: LegalPage) -> LegalSheetItem {
        switch page {
        case .privacy: LegalSheetItem(url: model.privacyURL)
        case .terms: LegalSheetItem(url: model.termsURL)
        }
    }

    private var ground: GridGround {
        colorScheme == .dark ? .observatory : .studio
    }

    /// `pop` empties the presenting tab's path (Rooms or Puzzles), so back and the
    /// kicked exit both land on that tab's list. The room is the only pushed element
    /// in either tab (join and a start both set the path to just the room, and an
    /// opened card appended onto an empty path), so a clear is the right pop.
    @ViewBuilder
    private func destination(_ route: ArrivalRoute, pop: @escaping () -> Void) -> some View {
        switch route {
        case .room(let gameId):
            if let facts = model.liveRoomFacts {
                RealRoomView(
                    room: RealRoom(
                        apiBaseURL: facts.apiBaseURL,
                        sessionBaseURL: facts.sessionBaseURL,
                        gameId: gameId,
                        tokenProvider: model.session.tokenProvider,
                        // The tapped card's seed (the seeded-birth rule, DESIGN.md §4,
                        // §12), recorded at tap time and keyed by gameId. nil for a
                        // deep link or a code-join (no card), which keeps the one-beat
                        // arrival. RealRoom seeds the store's roster and the share
                        // payload from it before the REST fetch.
                        seed: roomSeeds[gameId],
                        navigationPrefs: { typingPrefs.navigationPrefs }),
                    onBack: pop,
                    onExit: pop
                )
                .modifier(RoomNavBarChrome())
            } else {
                // Unreachable: roomRoute(for:) only builds .room with live facts.
                DemoRoomView(onBack: pop)
                    .modifier(RoomNavBarChrome())
            }
        case .fixtureRoom:
            DemoRoomView(onBack: pop)
                .modifier(RoomNavBarChrome())
        }
    }

    private func roomRoute(for gameId: String) -> ArrivalRoute {
        model.liveRoomFacts == nil ? .fixtureRoom : .room(gameId: gameId)
    }
}

/// The room's navigation-bar chrome (the toolbar-adoption ruling, DESIGN.md §4).
/// The bar is VISIBLE and title-less now (the room draws no title; the board
/// bleeds to the top edge under the bar's glass items, the full-bleed
/// amendment), the SYSTEM back button hidden so OUR back item is the only way
/// out (onBack/kicked-exit semantics), and the bar transparent so it floats over
/// the board rather than owning a strip. SolveScreen supplies the items through
/// `.toolbar`; this only sets the container's disposition. The floor is iOS 18,
/// and every API here lives at 18 or has an inert older path. Internal, not
/// private: ContentView's standalone room compositions (the harness, -i2*,
/// -demoRoom) wrap in their own NavigationStack and wear this same chrome, so
/// the rigs render the identical bar the pushed room does.
struct RoomNavBarChrome: ViewModifier {
    func body(content: Content) -> some View {
        content
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            // OUR back item leads the toolbar; the system back would double it
            // (the gate rig showed two chevrons), so it is hidden here. The edge
            // swipe-back survives the hiding (device census 2026-07-12: the pop
            // machinery stays enabled and delegated); what starved it was the
            // grid claiming every touch, fixed at the edge-pop gutter
            // (CrossyGridView).
            .navigationBarBackButtonHidden(true)
            // The board runs under the bar (the full-bleed amendment): a
            // transparent bar floats its glass items over the grid instead of
            // owning the top strip. The items carry their own glass on 26 and the
            // plain material below.
            .toolbarBackground(.hidden, for: .navigationBar)
            // The tab bar is NOT hidden here: attaching `.toolbar(.hidden, for:
            // .tabBar)` to the destination broke the first push per process (the nav
            // bar's items and the swipe-back both failed to materialize until a re-push
            // warmed them, owner report 2026-07-12). The tab bar hides at the tab level
            // instead, keyed on the path (see the Rooms/Puzzles tabs above).
            // Pinch-to-close is disabled in every room (owner ruling 2026-07-12):
            // the zoom transition's pinch dismiss fought the board's own pinch-zoom
            // at the camera floor (a pinch-in meaning "zoom out" instead left the
            // room), and it is a conflict, not a preference, so there is no toggle.
            // Swipe-to-close and the leading-edge pop are untouched.
            .background(ZoomPinchDismissDisabler())
    }
}
