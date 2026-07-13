// Mirrors apps/ios/Sources/CrossyDesign/AttributionSwitches.swift. ID-1 mute switches
// (apps/ios/DESIGN.md §9, ID-1, adopted 2026-07-10). Attribution at rest is ink; color
// appears in motion (the flash, a cursor) and at completion (the mosaic). Both stay for
// now, each behind a single constant, cheap to mute: the owner reserves judgment until they
// are seen on device. Flip one Boolean, rebuild, judge. Grep for "ID-1" to find every
// consumer.
package crossy.design

object AttributionSwitches {
    /// ID-1: color in motion, the conflict flash and the live cursor tint. `true` keeps it
    /// on; flip to `false` to mute after the on-device look.
    const val colorInMotionEnabled: Boolean = true

    /// ID-1: the completion mosaic (apps/ios/DESIGN.md §8). `true` keeps it on; flip to
    /// `false` to mute after the on-device look.
    const val completionMosaicEnabled: Boolean = true

    /// The completion confetti (owner ask 2026-07-11, amending §8's no-confetti line: a
    /// restrained roster-colored drift joins the mosaic). Same deal as the mosaic: one
    /// constant, cheap to mute after the on-device look.
    const val completionConfettiEnabled: Boolean = true
}
