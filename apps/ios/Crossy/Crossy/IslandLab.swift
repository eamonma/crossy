//
//  IslandLab.swift
//  Crossy
//
//  The island rendering rig (push track, phase 2a). Launching with -islandLab starts a
//  REAL Live Activity with fixture attributes and steps its content-state through
//  Activity.update from the foreground app, so the compact island, the long-press
//  expanded island, the lock-screen banner, and the terminal flip can all be judged
//  without APNs: no token upload, no session emitter, no key. Networking is another
//  slice; this rig only exercises rendering.
//
//  The steps walk the owner's rulings (2026-07-11): the pre-push fallback, an ongoing
//  mixed-presence room, an at-cap crew, a presence flip, near-done, the terminal flip,
//  and a stale simulation (a short stale date on an update, then a wait past it). Fixture
//  values reuse vectors/live-activity/content-state.json where they fit, so the rig and
//  the pinned wire agree.
//
//  Built to be walked by a hand on a device: every step is a labeled button, the status
//  line names the state the island is in right now, and nothing advances on its own.
//  The presence flip is a toggle (press for away, press again for back) and the terminal
//  step holds the completed frame for a beat before end(), so the flip is watchable on
//  the island before the activity retires. Two launch args serve scripted runs:
//  -islandLabAuto walks the sequence unattended; -islandLabHold <state> starts and holds
//  one state for a screenshot pass.
//
//  Evidence only: nothing in the room composes through this screen.
//

import ActivityKit
import CrossyProtocol
import SwiftUI
import UIKit

struct IslandLab: View {
    @State private var activity: Activity<SolveActivityAttributes>?
    @State private var status = "Not started"
    @State private var flippedAway = false
    @State private var autoRan = false
    /// Whether the fixture avatars landed in the shared container this session, so the status
    /// line can say "avatars on" vs "no app group yet" (the entitlement lands after this code).
    @State private var avatarsWritten = false

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 14) {
                Text(verbatim: "Island Lab")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(.white)
                Text(verbatim: status)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white.opacity(0.6))
                    .lineLimit(2)

                labButton("1 — pre-push (attributes fallback)") { await stepPrePush() }
                labButton("2 — ongoing mixed presence 34/78") { await stepMixed() }
                labButton("3 — at-cap crew 61/78") { await update(Fixtures.atCap, as: "at-cap crew, 61 of 78") }
                labButton(flippedAway ? "4 — presence flip (M comes back)" : "4 — presence flip (M goes away)") {
                    await stepFlip()
                }
                labButton("5 — near-done 74/78") { await update(Fixtures.nearDone, as: "near-done, 74 of 78") }
                labButton("6 — terminal flip (completed)") { await stepTerminal() }
                labButton("7 — stale simulation") { await stepStale() }
                labButton("8 — ancient room (90 h old)") { await stepAncient() }

                Divider().overlay(.white.opacity(0.2))
                labButton("End the activity") { await end() }
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        // simctl cannot tap (no assistive access), so an optional launch arg auto-walks
        // the whole sequence with a beat between steps for a scripted screenshot pass.
        // Plain -islandLab is the manual rig.
        .task {
            guard !autoRan else { return }
            autoRan = true
            let arguments = ProcessInfo.processInfo.arguments
            if arguments.contains("-islandLabAuto") {
                await autoWalk()
            } else if let index = arguments.firstIndex(of: "-islandLabHold"),
                arguments.indices.contains(index + 1) {
                // Start and hold one named state indefinitely (no terminal, no end), so a
                // simulator screenshot can catch a live island: the compact/expanded
                // island and the lock-screen banner render only while the activity holds.
                await stepPrePush()
                switch arguments[index + 1] {
                case "mixed": await stepMixed()
                case "atCap": await update(Fixtures.atCap, as: "at-cap crew, 61 of 78")
                case "nearDone": await update(Fixtures.nearDone, as: "near-done, 74 of 78")
                case "completed": await update(Fixtures.completed, as: "completed, held (no end)")
                case "stale": await stepStale()
                case "ancient": await stepAncient()
                default: break
                }
            }
        }
    }

    private func labButton(_ title: String, _ action: @escaping () async -> Void) -> some View {
        Button {
            Task { await action() }
        } label: {
            Text(verbatim: title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 12)
                .padding(.horizontal, 14)
                .background(.white.opacity(0.08), in: .rect(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Steps

    /// Start (or restart) the activity with fixture attributes and an EMPTY content-state:
    /// the attributes fallback, which must look exactly like it did before the push track.
    /// This step exists precisely to prove the fallback render (no meter, no ring), so it
    /// keeps requesting the empty state on purpose. The REAL journey is BORN LIVE: the room
    /// requests carrying its real state at backgrounding (SolveActivityController.start),
    /// so a real island never shows this frame; the server drives it from there over APNs.
    private func stepPrePush() async {
        await end()
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            status = "Live Activities are off in Settings"
            return
        }
        writeFixtureAvatars()
        let attributes = SolveActivityAttributes(
            firstFillAt: Date().addingTimeInterval(-Fixtures.elapsedSeconds),
            roomName: Fixtures.roomName,
            pucks: Fixtures.snapshotPucks)
        do {
            activity = try Activity.request(
                attributes: attributes,
                content: .init(state: IslandContentState(), staleDate: nil))
            flippedAway = false
            status = "1 — pre-push: attributes cluster, progress hidden\(avatarStatusSuffix)"
        } catch {
            status = "request failed: \(error.localizedDescription)"
        }
    }

    /// Write the two fixture avatars (E and A) into the shared container through the store, so
    /// the island shows a real image layered over the colored initial on a real device. The
    /// store is nil-tolerant: if the App Group entitlement has not landed yet, this is a clean
    /// no-op and `avatarStatusSuffix` reads "no app group yet" so the rig reports the absence
    /// instead of failing. Cheap enough (two tiny PNGs) to run on the request site.
    private func writeFixtureAvatars() {
        let store = IslandAvatarStore()
        guard store.directory != nil else {
            avatarsWritten = false
            return
        }
        if let bee = Fixtures.avatarPNGForE, let image = UIImage(data: bee) {
            store.write(image: image, for: Fixtures.avatarUserIdE)
        }
        if let ada = Fixtures.avatarPNGForA, let image = UIImage(data: ada) {
            store.write(image: image, for: Fixtures.avatarUserIdA)
        }
        avatarsWritten = true
    }

    /// The status-line tail that reports whether the fixture avatars are readable this session:
    /// "avatars on" when the shared container took them, "no app group yet" when the
    /// entitlement is absent (the island then stays initials, byte-identical to before).
    private var avatarStatusSuffix: String {
        avatarsWritten ? " (avatars on)" : " (no app group yet)"
    }

    /// One update, and the status line names the state so the hand on the device always
    /// knows what the island should be showing.
    private func update(_ state: IslandContentState, as label: String, staleDate: Date? = nil) async {
        guard let activity else {
            status = "Start step 1 first"
            return
        }
        await activity.update(.init(state: state, staleDate: staleDate))
        status = label
    }

    private func stepMixed() async {
        flippedAway = false
        await update(Fixtures.mixed, as: "2 — ongoing mixed: A away at 0.38, 34 of 78")
    }

    /// The presence flip as a toggle, no timer: press once and M drops to the away
    /// register, press again and M comes back. The hand sets the pace.
    private func stepFlip() async {
        if flippedAway {
            await update(Fixtures.mixed, as: "4 — flip back: M returned to full")
        } else {
            await update(Fixtures.oneAway, as: "4 — flip away: M dimmed to 0.38")
        }
        flippedAway.toggle()
    }

    /// The terminal flip, ruled 2026-07-11: done is an EVENT. Two seconds after the tap,
    /// the completed frame lands as an ALERTING update, and the system announces it by
    /// expanding the island itself (no long-press): every puck full, timer frozen, meter
    /// sealed, "Solved together". The end follows once the announcement has had its
    /// moment, and the default dismissal keeps the final frame on the lock screen. The
    /// real channel mirrors this as an alert-carrying update push before the end event.
    private func stepTerminal() async {
        status = "6 — solving the last cell…"
        try? await Task.sleep(for: .seconds(2))
        guard let activity else {
            status = "Start step 1 first"
            return
        }
        await activity.update(
            .init(state: Fixtures.completed, staleDate: nil),
            alertConfiguration: AlertConfiguration(
                title: "Solved together",
                body: LocalizedStringResource(stringLiteral: Fixtures.roomName),
                sound: .default))
        status = "6 — done: the island announced itself (expanded, solved together)"
        try? await Task.sleep(for: .seconds(6))
        await activity.end(
            .init(state: Fixtures.completed, staleDate: nil),
            dismissalPolicy: .default)
        status = "6 — ended with the terminal frame (lock screen keeps it)"
    }

    /// The ancient room (owner ruling 2026-07-11, the ninety-hour question): a fresh
    /// activity whose anchor sits 90 hours in the past, so the clock renders the coarse
    /// register ("3 d 18 h") instead of a ticking timer. Needs its own request: the
    /// anchor is an attribute, fixed at request time.
    private func stepAncient() async {
        await end()
        writeFixtureAvatars()
        let attributes = SolveActivityAttributes(
            firstFillAt: Date().addingTimeInterval(-Fixtures.ancientSeconds),
            roomName: Fixtures.roomName,
            pucks: Fixtures.snapshotPucks)
        do {
            activity = try Activity.request(
                attributes: attributes,
                content: .init(state: Fixtures.mixed, staleDate: nil))
            flippedAway = false
            status = "8 — ancient room: 90 h old, the clock reads 3 d 18 h\(avatarStatusSuffix)"
        } catch {
            status = "request failed: \(error.localizedDescription)"
        }
    }

    /// A stale simulation: push an ongoing state with a stale date a beat out, then wait
    /// past it. Everything push-fed should drop to the away register while the timer stays
    /// full white.
    private func stepStale() async {
        await update(
            Fixtures.mixed, as: "7 — stale in 2 s: push-fed dims, timer stays white",
            staleDate: Date().addingTimeInterval(2))
    }

    private func end() async {
        for activity in Activity<SolveActivityAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
        activity = nil
        flippedAway = false
        status = "Ended"
    }

    /// The scripted walk for an unattended pass: each state, a beat apart.
    private func autoWalk() async {
        await stepPrePush()
        try? await Task.sleep(for: .seconds(2))
        await stepMixed()
        try? await Task.sleep(for: .seconds(2))
        await update(Fixtures.atCap, as: "at-cap crew, 61 of 78")
        try? await Task.sleep(for: .seconds(2))
        await update(Fixtures.nearDone, as: "near-done, 74 of 78")
        try? await Task.sleep(for: .seconds(2))
        await stepTerminal()
    }
}

// MARK: - Fixtures (vectors/live-activity values where they fit)

private enum Fixtures {
    static let roomName = "Sunday, together"
    /// A live island caps at MM:SS territory; start ~28 minutes in so the timer reads a
    /// realistic mm:ss and the completed step's frozen interval stays under an hour.
    static let elapsedSeconds: TimeInterval = 28 * 60 + 14
    /// The ancient room: 90 hours, exactly 3 d 18 h in the coarse register.
    static let ancientSeconds: TimeInterval = 90 * 3600

    /// The two fixture-avatar userIds (the members whose pucks carry a bundled image, written
    /// to the shared container at lab start), so the rig judges the image layered over the
    /// initial on a real island. E and A carry images; M stays a plain initial, the null case.
    static let avatarUserIdE = "island-lab-E"
    static let avatarUserIdA = "island-lab-A"

    /// The pre-push snapshot cluster (attributes), the frozen fallback. Same colors as the
    /// mixed vector so the fallback and the first push read as the same people. E and A carry
    /// the fixture avatar userIds so even the fallback shows avatar pucks.
    static let snapshotPucks: [SolveActivityAttributes.Puck] = [
        .init(initial: "E", red: 214, green: 178, blue: 92, userId: avatarUserIdE),
        .init(initial: "A", red: 127, green: 119, blue: 221, userId: avatarUserIdA),
        .init(initial: "M", red: 92, green: 184, blue: 148),
    ]

    /// "ongoing room, mixed connected and disconnected pucks" (content-state.json).
    static let mixed = IslandContentState(
        pucks: [
            .init(initial: "E", red: 214, green: 178, blue: 92, connected: true, userId: avatarUserIdE),
            .init(initial: "A", red: 127, green: 119, blue: 221, connected: false, userId: avatarUserIdA),
            .init(initial: "M", red: 92, green: 184, blue: 148, connected: true),
        ],
        filled: 34, total: 78, status: .ongoing, completedAt: nil)

    /// The mixed room with the third member flipped away too, so two pucks dim at once.
    static let oneAway = IslandContentState(
        pucks: [
            .init(initial: "E", red: 214, green: 178, blue: 92, connected: true, userId: avatarUserIdE),
            .init(initial: "A", red: 127, green: 119, blue: 221, connected: false, userId: avatarUserIdA),
            .init(initial: "M", red: 92, green: 184, blue: 148, connected: false),
        ],
        filled: 34, total: 78, status: .ongoing, completedAt: nil)

    /// "at-cap cluster of four pucks in presence order" (content-state.json).
    static let atCap = IslandContentState(
        pucks: [
            .init(initial: "H", red: 214, green: 178, blue: 92, connected: true),
            .init(initial: "B", red: 127, green: 119, blue: 221, connected: true),
            .init(initial: "R", red: 92, green: 184, blue: 148, connected: false),
            .init(initial: "J", red: 224, green: 122, blue: 95, connected: true),
        ],
        filled: 61, total: 78, status: .ongoing, completedAt: nil)

    /// Near done: the mixed crew at 74/78, so the ring and meter read nearly sealed.
    static let nearDone = IslandContentState(
        pucks: [
            .init(initial: "E", red: 214, green: 178, blue: 92, connected: true),
            .init(initial: "A", red: 127, green: 119, blue: 221, connected: true),
            .init(initial: "M", red: 92, green: 184, blue: 148, connected: true),
        ],
        filled: 74, total: 78, status: .ongoing, completedAt: nil)

    /// The completed terminal state. completedAt is the anchor plus the elapsed interval,
    /// so the frozen solve time reads the same mm:ss the live timer had reached.
    static let completed = IslandContentState(
        pucks: [
            .init(initial: "E", red: 214, green: 178, blue: 92, connected: true, userId: avatarUserIdE),
            .init(initial: "A", red: 127, green: 119, blue: 221, connected: false, userId: avatarUserIdA),
            .init(initial: "M", red: 92, green: 184, blue: 148, connected: true),
        ],
        filled: 78, total: 78, status: .completed,
        completedAt: ISO8601DateFormatter().string(from: Date()))

    /// Two small PNGs inlined as base64 (mirroring DemoRoom's fixture avatars, no network),
    /// written to the shared container at lab start so the island shows a real image layered
    /// over the colored initial. Bee is a cool geometric mark; Ada a warm two-tone disc.
    static let avatarPNGForE = Data(base64Encoded: avatarBase64Bee)
    static let avatarPNGForA = Data(base64Encoded: avatarBase64Ada)

    private static let avatarBase64Bee =
        "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAAXNSR0IArs4c6QAAADhlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAqACAAQAAAABAAAAMKADAAQAAAABAAAAMAAAAAD4/042AAACg0lEQVRoBe1ZOUsDURCemKDEQoMHhoBBbTQaQRQRSy9QtLKwsLCw1MbO32Angq2FhYWCnSgI/gAlIigGGxUFiXgQLZRIPPIFEjYaZea93Y2BHViSze77jnnH7ry4WgZnPqmIo6SItaelOwYK3YNODxS6BzxWCTjeXsiBbh+Zzzk368QZQmZlUhWn6HvA1DlQ2RSg6lADVTT4fyS0Y3acni9j9BC9pKfzmx/XVX/QN+Ai8neHKNjfReU1vl91+BoDhCPY10kv93G62otQ7CBKpPkio2XAW+uj0OQQVdTX/So83wUYbZkYoEBvmKJru/R6F893G+s35TlQ1RykrrkJsXijKhgHBrBUQ8kACMPTo+QpK1XlzbYDBrBUTYgNYNi0Tg1TidudFaH7BVjABLY0ZAZSExZj3ozMfxcKTGBTikMSIgNYbaQTViIG2OCQhMgAlkqrQ8rBNoCH1F/rvFnGwAEubrAN4AlrV0i42AbyvR5YZUjCxTZgx/DJJETCxTbg8ZZl8C3/lHCxDViuWpGAbSD5mlCkkDeTcLEN4BXYrpBwsQ2gGLErJFxsAyim7AoJF9sAykBJ16qaBYek5GQbgCCUgVaHlENkADXs8/WtZR6Ana6TBQwiAyjAUcMmE28CCt6twAS2tMiXGUhpQQF+urpDH+/vPGWMu4AFTJXiXmwAeh7PruhkZcuUnkDmgQVMlVAykDERWVzXmhMY88BQFQ8dWvtC6PLDpQ3WxpYxu1gq/8XGVlpUamLH9qPpI2drsa3eqJniFzf/dGvRIBMPoOxDaKzHcIXoaHkz59ysE+U5YJYAXRzHgG4Gddu7nH/qdVOo2d6ZA5oJ1G7u9IB2CjUBvgCsasbF2M4EWAAAAABJRU5ErkJggg=="
        + "loMDgAAAABJRU5ErkJggg=="
    private static let avatarBase64Ada =
        "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAAXNSR0IArs4c6QAAADhlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAqACAAQAAAABAAAAMKADAAQAAAABAAAAMAAAAAD4/042AAADVUlEQVRoBe1YbUsUURg9M7vjrrujub6QYGBaKlHmlygoev8QFES/NCIo8EPvFBR9MYtQSxMSDF9203HddXZmmzNZLKHeO/deXYTOp2Xuc895zt17n3nuWP78/ToOMexDnHucetqkgSAI8PHDDD5NTGNu9jvW17yYvq3dxcDgMZweG8aZs0NIpVLGZC1TW2hyYgqPHjzDynJpz+S6ujtw5951jI6N7BknO6htIAzrePzwOV48eSurGcddvXkBt+9eg21bieb9G6x9BlSSZxI0zLm60DLAbZN05RsT5lxy6EDZAA8s97wuyEEuVSgbYLURHViZpMhBLlUoG2CpNAUdLmUDrPOmoMOlbODPS8qECR0uZQMmEjfBoWyA7YEp6HApG2BvYwo6XMoG2JiZgg6XsgF2lWzMdEEOcqlC2QBbYnaVuiCHTnutdR9gS8yukj1NTy6D4x0uet0sCq0tcFscOPbv9fHDEN6Wj+LmFha9Cr6VPCyVq/Fc3bZaq50Oo6Q2pmexMjmFTD3ZzbRqWegaHUF+eBB2ZFYVSgbq0YoycS9KvO7XVLXjeZaThrttxNr+x5IQJjYQbJRRfP0e/nIxiY4w1ukuoHDpHFL5nDC2MSDRIfaLP7E8/tJ48kyICxJzRxpJIG2gtr6B1advEFaqSfgTxZKbGtSShZSBenThKL56h7C6JcurHEcNalFTBlIGvM9fUCutyfAZiaEWNWUgNBD6UamUJJMRlI2hJrVFEBqozC9ol0pREjuNszxTWwSxgYUfIo59G69IaAsNsHQ2CzUJbaGB/SybooUJJEq20IBIpNnjQgN2NtO0HFMS2kIDTuFI0wykJbSFBrJ9R5tmQEZbbKC/D2x5DxrUzEbaIggN2I6D/KmTIh7j49SktghCAyRwI7J0R7uIy9g4tagpAykDVnSBL1w+DzvTIsOpFUMNalFTBlIGSJRuy6PzxkXsZ1klNzWoJQtpAyRkSe2+dQW8/pkGOWNuidLZqJ34TszJh/pS3+ien1XKM3Mof51H4JUbh4S/U24OuRP9yA0NHPxnlZ2y81dLqC4uxZfz2rqHYLPy9x7Bmp5qzUZ72423X6a3B06n/mdJ5mHsDcWETCW10wLt9izRId6NpJnP/xto5upT+xcTfkuxPz1lPgAAAABJRU5ErkJggg=="
}
