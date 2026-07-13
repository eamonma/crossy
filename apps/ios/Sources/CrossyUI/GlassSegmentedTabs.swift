// The completed clue chrome's Clues/Analysis segmented control (owner ruling
// 2026-07-13). A single glass thumb slides between the two segments on
// matchedGeometryEffect, so the move is one continuous Liquid Glass shape crossing
// the width (glassEffectID morphs only merge NEARBY shapes, so it cannot slide a
// full segment apart; a moved matched frame can). Three disciplines the owner's
// device found the hard way: the segment is a FIXED height (a flexible glass slot
// fills the whole panel), the labels are a STRICTLY separate top layer (text inside
// the glass frosts), and the thumb is decorative selection state (no .interactive();
// the buttons above own the touch). iOS 26 wears the glass; 18 through 25 wear a
// filled thumb, the one §4 fallback.

import CrossyDesign
import SwiftUI

@available(iOS 17.0, macOS 14.0, *)
public struct GlassSegmentedTabs: View {
    @Binding var selection: AnalysisTab
    let ground: GridGround
    /// The tab that wears a quiet gold dot while it is NOT selected (the web
    /// panel's unselected Analysis marker); nil for none.
    let goldDotOn: AnalysisTab?

    @Namespace private var thumb

    public init(
        selection: Binding<AnalysisTab>, ground: GridGround, goldDotOn: AnalysisTab? = nil
    ) {
        self._selection = selection
        self.ground = ground
        self.goldDotOn = goldDotOn
    }

    private let height: CGFloat = 34

    public var body: some View {
        ZStack {
            // Behind: the sliding thumb, one element that matchedGeometry moves
            // between the two slots.
            HStack(spacing: 0) {
                ForEach(AnalysisTab.allCases, id: \.self) { tab in
                    Color.clear
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .overlay {
                            if selection == tab {
                                thumbShape
                                    .matchedGeometryEffect(id: "thumb", in: thumb)
                                    .padding(2)
                            }
                        }
                }
            }
            // In front: the labels, crisp, and the taps.
            HStack(spacing: 0) {
                ForEach(AnalysisTab.allCases, id: \.self) { tab in
                    Button {
                        withAnimation(.smooth(duration: 0.3)) { selection = tab }
                    } label: {
                        label(tab)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(selection == tab ? [.isSelected] : [])
                }
            }
        }
        .frame(height: height)
        .padding(3)
        .background(
            Capsule(style: .continuous)
                .fill(Color(rgb: ground.tokens.number).opacity(0.10)))
    }

    @ViewBuilder
    private var thumbShape: some View {
        #if os(iOS)
            if #available(iOS 26.0, *) {
                Capsule(style: .continuous)
                    .fill(.clear)
                    .glassEffect(.regular, in: .capsule)
            } else {
                filledThumb
            }
        #else
            filledThumb
        #endif
    }

    private var filledThumb: some View {
        Capsule(style: .continuous)
            .fill(Color(rgb: ground.tokens.cell))
            .shadow(color: .black.opacity(0.12), radius: 2, y: 1)
    }

    private func label(_ tab: AnalysisTab) -> some View {
        let selected = selection == tab
        return HStack(spacing: 5) {
            Text(verbatim: tab == .clues ? "Clues" : "Analysis")
                .font(.system(size: 13.5, weight: .semibold))
                .foregroundStyle(
                    Color(rgb: selected ? ground.tokens.ink : ground.tokens.number))
            if tab == goldDotOn, !selected {
                Circle()
                    .fill(Color(rgb: AnalysisPalette.gold(ground)))
                    .frame(width: 6, height: 6)
            }
        }
        .accessibilityLabel(Text(verbatim: tab == .clues ? "Clues" : "Analysis"))
    }
}
