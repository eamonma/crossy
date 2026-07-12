// The clue-prose rendering twin (clue-formatting wave, owner ruling 2026-07-12: clue
// markup renders as structured runs, never stripped, never raw HTML). Given a clue's
// styled runs and the surface's own base font size, build an AttributedString the
// surface's `Text` renders inheriting that font: italic and bold ride SwiftUI's inline
// presentation intents, so they stay RELATIVE to the surrounding font and every call
// site keeps its size and weight family; subscript and superscript shrink onto a smaller
// font and shift the baseline down or up. Combined styles compose on one run.
//
// Absent runs are not this file's job: a nil `runs` surface renders `Text(verbatim:)`
// exactly as before, byte for byte. This mapper runs only when a clue actually carries
// styled spans, and its projection (the concatenated run text) equals the clue's plain
// `text` by the server's guarantee, so nothing a reader sees changes except the styling.
//
// Sub/sup sizing lives HERE, not per call site: the wave's rule is that a sub/sup must
// not grow a tight list row's line height. The smaller run font (a fixed fraction of the
// base) keeps ascenders and descenders inside the base line box, and the baseline offset
// is scaled to the base so it never pushes a glyph past that box. A call site passes only
// its base size; it cannot get the constraint wrong.

import SwiftUI

/// The clue-prose mapper: runs plus a base font size and weight to an AttributedString.
public enum ClueTextRuns {
    /// Sub/sup glyphs render at this fraction of the base size. Small enough that the
    /// shrunk glyph plus its baseline shift stays inside the base line box (so a tight
    /// list row keeps its height), large enough to read. Matches the web's ~0.75em.
    static let subSuperScale: CGFloat = 0.72

    /// Superscript lift and subscript drop, as a fraction of the base size. Modest by
    /// design: paired with the shrunk font, the shifted glyph never exceeds the base
    /// line's ascent (sup) or descent (sub), so neither grows the row.
    static let superscriptRise: CGFloat = 0.34
    static let subscriptDrop: CGFloat = 0.16

    /// Build the styled AttributedString for a clue's runs at a surface's base font.
    ///
    /// `size` and `weight` are the surface's own `.system(size:weight:)` inputs, so the
    /// result inherits that exact font: plain runs carry it untouched, italic and bold
    /// ride the inline presentation intent (relative to it, family and size preserved),
    /// and sub/sup carry an explicit smaller system font at the same weight plus a
    /// baseline offset. An empty runs list yields an empty string; a run with no styles
    /// contributes its text with no attributes.
    public static func attributed(
        _ runs: [ClueTextRun], size: CGFloat, weight: Font.Weight = .regular
    ) -> AttributedString {
        var result = AttributedString()
        for run in runs {
            result.append(styled(run, size: size, weight: weight))
        }
        return result
    }

    /// One run to its attributed span. The intents compose (bold + italic reads as a
    /// bold-italic run), and sub/sup layer a smaller font and a baseline offset on top of
    /// whatever emphasis the run also carries.
    private static func styled(
        _ run: ClueTextRun, size: CGFloat, weight: Font.Weight
    ) -> AttributedString {
        var span = AttributedString(run.text)
        guard !run.styles.isEmpty else { return span }

        let isBold = run.styles.contains(.bold)
        let isItalic = run.styles.contains(.italic)
        let isSub = run.styles.contains(.subscript_)
        let isSup = run.styles.contains(.superscript_)

        if isSub || isSup {
            // Sub/sup carry an explicit smaller system font (so the size is fixed here,
            // not by the call site) plus a baseline offset. Bold and italic fold DIRECTLY
            // into that font rather than through an inline intent, so the shrunk glyph
            // still reads bold or italic and the two paths never fight over one run's
            // font. The shrink and the offset are both scaled to the base, and the mapper
            // owns both, so the no-row-growth constraint holds wherever the run renders.
            // If a run carried both sub and sup (canonical runs never do), sup wins; the
            // mapper stays total either way.
            var scaled = Font.system(size: size * subSuperScale, weight: isBold ? .bold : weight)
            if isItalic { scaled = scaled.italic() }
            span.font = scaled
            span.baselineOffset = isSup ? size * superscriptRise : -(size * subscriptDrop)
        } else {
            // Plain-size runs take italic and bold as inline presentation intents:
            // SwiftUI's Text renders these RELATIVE to the font set on the view, so the
            // surface's size and weight family carry through and only the slant/weight
            // changes. They compose into one option set, so a run styled both reads as
            // bold italic.
            var intent: InlinePresentationIntent = []
            if isItalic { intent.insert(.emphasized) }
            if isBold { intent.insert(.stronglyEmphasized) }
            if !intent.isEmpty { span.inlinePresentationIntent = intent }
        }
        return span
    }
}

extension Text {
    /// A clue's prose as a `Text`, styled from its runs or plain when it has none. The
    /// one swap point every clue-prose surface uses: pass the entry and the surface's own
    /// base `size`/`weight` (the same numbers its `.font(.system(...))` carries), then
    /// keep every other modifier as before. A clue with no runs takes the verbatim path,
    /// byte-identical to `Text(verbatim: entry.text)`, so unstyled clues (and every
    /// pre-wave puzzle) render exactly as they do today. The styled path's projection
    /// equals `entry.text` by the server's guarantee, so the reader sees the same words.
    init(clueProse entry: ClueEntry, size: CGFloat, weight: Font.Weight = .regular) {
        if let runs = entry.runs, !runs.isEmpty {
            self.init(ClueTextRuns.attributed(runs, size: size, weight: weight))
        } else {
            self.init(verbatim: entry.text)
        }
    }
}
