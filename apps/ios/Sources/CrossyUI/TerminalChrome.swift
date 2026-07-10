// The kicked exit, the room's terminal screen (roadmap I2d): paper, the one
// honest sentence, and a way back (ID-5; EXPERIENCE.md Kicked). Copy lives in
// RoomTerminal so the words are pinned headlessly. The stats card that used to
// live here grew into the room-facts card (RoomFactsCard.swift, owner ruling
// 2026-07-10: the time pill is the room's facts).

import CrossyDesign
import SwiftUI

/// The kicked exit: the room's terminal screen. One honest sentence, plainly
/// worded (ID-5), and one affordance out so it is never a dead end; the seat is
/// gone and the code is dead for this account (denylist), so nothing else here
/// pretends otherwise.
@available(iOS 18.0, macOS 14.0, *)
@MainActor
struct KickedExit: View {
    let ground: GridGround
    let onExit: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            Text(verbatim: RoomTerminal.kickedNotice)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(Color(rgb: ground.tokens.ink))
                .multilineTextAlignment(.center)
            Button(action: onExit) {
                Text(verbatim: RoomTerminal.kickedExitWord)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color(rgb: ground.tokens.ink))
                    .padding(.horizontal, 28)
                    .frame(height: 46)
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .modifier(ChromeGlassSurface(cornerRadius: 23))
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(rgb: ground.tokens.canvas).ignoresSafeArea())
    }
}
