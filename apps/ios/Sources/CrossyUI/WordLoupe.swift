// The completed Analysis board's directional loupe: one piece of clear glass above paper.
// The board is never sampled, redrawn, or filtered by this view. The glass spans the active word
// with a small unclamped overhang, while the selected-cell etching is a separate board-space view;
// changing axis can therefore morph the capsule without stretching the focus square.

import CoreGraphics
import CrossyDesign
import SwiftUI

/// Projected viewport geometry for the word glass and its independent focus square.
struct WordLoupeLayout: Equatable {
  let lens: CGRect
  let focus: CGRect

  /// Enough air to read as an object hovering over the answer, without becoming a thick lens.
  static let overhangCells: CGFloat = 0.1

  init?(puzzle: GridPuzzle, selection: GridSelection, camera: GridCamera) {
    let cells = puzzle.wordCells(
      through: selection.cell, isAcross: selection.isAcross)
    guard !cells.isEmpty else { return nil }

    var wordBounds = GridModule.cellRect(selection.cell, cols: puzzle.cols)
    for cell in cells {
      wordBounds = wordBounds.union(GridModule.cellRect(cell, cols: puzzle.cols))
    }
    let overhang = Self.overhangCells * GridModule.unit
    lens = camera.project(wordBounds.insetBy(dx: -overhang, dy: -overhang))
    focus = camera.project(GridModule.cellRect(selection.cell, cols: puzzle.cols))
  }
}

extension GridCamera {
  /// Board module units into the viewport points used by the Canvas and its overlays.
  fileprivate func project(_ rect: CGRect) -> CGRect {
    CGRect(
      x: offset.x + rect.minX * scale,
      y: offset.y + rect.minY * scale,
      width: rect.width * scale,
      height: rect.height * scale)
  }
}

/// The view layer above the completed mosaic and below reaction stickers.
struct WordLoupeOverlay: View {
  let puzzle: GridPuzzle
  let selection: GridSelection
  let camera: GridCamera
  let ground: GridGround

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    GeometryReader { proxy in
      if let layout = WordLoupeLayout(
        puzzle: puzzle, selection: selection, camera: camera)
      {
        let highlight = Self.highlight(
          for: layout.lens, in: proxy.size)
        ZStack {
          WordLoupeSurface(ground: ground, highlight: highlight)
            .shadow(
              color: Color(rgb: ground.tokens.ink).opacity(0.14),
              radius: 3, x: 0, y: 2
            )
            .shadow(
              color: Color(rgb: ground.tokens.ink).opacity(0.16),
              radius: 12, x: 0, y: 6
            )
            .shadow(
              color: Color(rgb: ground.tokens.ink).opacity(0.08),
              radius: 24, x: 0, y: 14
            )
            .frame(width: layout.lens.width, height: layout.lens.height)
            .position(x: layout.lens.midX, y: layout.lens.midY)

          WordLoupeFocus(ground: ground)
            .frame(width: layout.focus.width, height: layout.focus.height)
            .position(x: layout.focus.midX, y: layout.focus.midY)
        }
        // Every cursor move and axis toggle pours the existing glass to its new frame. The focus
        // square has the same one-cell dimensions at both ends, so it translates without swelling.
        // Camera-follow ticks do not change `selection` and remain locked to the Canvas beneath.
        .animation(reduceMotion ? nil : .crossyChrome, value: selection)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
      }
    }
  }

  /// A fixed light above the board: as the loupe moves, the highlight travels over its material
  /// instead of being painted at a fixed point inside the capsule.
  private static func highlight(for lens: CGRect, in viewport: CGSize) -> UnitPoint {
    let light = CGPoint(x: viewport.width * 0.24, y: viewport.height * 0.08)
    let x = lens.width > 0 ? (light.x - lens.minX) / lens.width : 0.5
    let y = lens.height > 0 ? (light.y - lens.minY) / lens.height : 0.5
    return UnitPoint(
      x: min(max(x, -0.25), 1.25),
      y: min(max(y, -0.4), 1.4))
  }
}

/// Thin liquid surface with no backdrop sampling. The system glass shader is intentionally absent:
/// over the dense mosaic it lenses the letters across the whole capsule instead of playing only at
/// the material edge. Two sub-pixel rims and a faint moving specular field preserve the paper.
private struct WordLoupeSurface: View {
  let ground: GridGround
  let highlight: UnitPoint

  var body: some View {
    let opposite = UnitPoint(x: 1 - highlight.x, y: 1 - highlight.y)
    ZStack {
      Capsule()
        .fill(
          LinearGradient(
            colors: [
              Color.white.opacity(0.09),
              Color.white.opacity(0.025),
              Color.clear,
            ],
            startPoint: highlight,
            endPoint: opposite))
      Capsule()
        .strokeBorder(
          Color(rgb: ground.tokens.ink).opacity(0.42),
          lineWidth: 1.5)
      Capsule()
        .inset(by: 0.75)
        .strokeBorder(
          LinearGradient(
            colors: [
              Color.white.opacity(0.98),
              Color.white.opacity(0.36),
              Color(rgb: ground.tokens.ink).opacity(0.48),
              Color.white.opacity(0.82),
            ],
            startPoint: highlight,
            endPoint: opposite),
          lineWidth: 1)
      Capsule()
        .inset(by: 2)
        .strokeBorder(
          LinearGradient(
            colors: [
              Color.white.opacity(0.58),
              Color.clear,
              Color(rgb: ground.tokens.ink).opacity(0.12),
            ],
            startPoint: highlight,
            endPoint: opposite),
          lineWidth: 0.5)
    }
  }
}

/// The selected square is etched independently of the morphing word glass.
private struct WordLoupeFocus: View {
  let ground: GridGround

  var body: some View {
    ZStack {
      Rectangle()
        .strokeBorder(
          Color(rgb: ground.tokens.ink).opacity(0.62), lineWidth: 1)
      Rectangle()
        .inset(by: 1)
        .strokeBorder(Color.white.opacity(0.82), lineWidth: 1)
    }
    .shadow(
      color: Color(rgb: ground.tokens.ink).opacity(0.12),
      radius: 3, x: 0, y: 0)
  }
}
