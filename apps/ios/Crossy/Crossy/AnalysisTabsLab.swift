//
//  AnalysisTabsLab.swift
//  Crossy
//
//  Evidence rig (-analysisTabsLab), the MeltLab/SeededBirthLab pattern: the Liquid
//  Glass Clues/Analysis segmented control (GlassSegmentedTabs) in isolation over a
//  busy ground, both grounds at once, so the thumb's size, the label crispness, and
//  the matchedGeometry slide are judgeable without solving a game. Evidence only.
//

import CrossyUI
import SwiftUI

@available(iOS 17.0, *)
struct AnalysisTabsLab: View {
    @State private var light: AnalysisTab = .analysis
    @State private var dark: AnalysisTab = .clues

    var body: some View {
        ZStack {
            // A busy, colorful ground so the glass frosting actually has something
            // to refract (a flat ground hides the effect).
            LinearGradient(
                colors: [.orange, .pink, .purple, .blue, .teal],
                startPoint: .topLeading, endPoint: .bottomTrailing)
                .ignoresSafeArea()

            VStack(spacing: 48) {
                section("Studio (light ground)", ground: .studio, selection: $light)
                section("Observatory (dark ground)", ground: .observatory, selection: $dark)
            }
            .padding(.horizontal, 24)
        }
    }

    private func section(
        _ title: String, ground: GridGround, selection: Binding<AnalysisTab>
    ) -> some View {
        VStack(spacing: 12) {
            Text(verbatim: title)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.white)
            AnalysisTabPicker(selection: selection)
                .frame(width: 320)
                // Force each ground's appearance so the system control's light and
                // dark styling both show over the busy field.
                .environment(\.colorScheme, ground.isDark ? .dark : .light)
        }
    }
}
