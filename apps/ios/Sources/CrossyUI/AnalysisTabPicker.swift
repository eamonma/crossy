// The completed clue chrome's Clues/Analysis segmented control (owner ruling
// 2026-07-13): the SYSTEM segmented Picker, so it wears whatever the platform gives
// a segmented control (Liquid Glass and its own selection slide on iOS 26) with no
// hand-rolled material to drift from the system's. The active tab writes
// RoomChromeModel.analysisTab through the binding. The gold "unselected Analysis"
// dot the custom control carried is dropped here: a system segment holds a label,
// not a custom row, and the owner chose the system control over the marker.

import SwiftUI

@available(iOS 17.0, macOS 14.0, *)
public struct AnalysisTabPicker: View {
    @Binding var selection: AnalysisTab

    public init(selection: Binding<AnalysisTab>) {
        self._selection = selection
    }

    public var body: some View {
        Picker(selection: $selection) {
            Text(verbatim: "Clues").tag(AnalysisTab.clues)
            Text(verbatim: "Analysis").tag(AnalysisTab.analysis)
        } label: {
            Text(verbatim: "Panel view")
        }
        .pickerStyle(.segmented)
        .labelsHidden()
    }
}
