import XCTest

@testable import CrossyUI

final class WordLoupeTests: XCTestCase {
  private let camera = GridCamera(scale: 2, offset: CGPoint(x: 10, y: 20))
  private let open = GridPuzzle(rows: 5, cols: 5, blocks: [])

  func test_acrossLoupeOverhangsWordWhileFocusStaysOneCell() throws {
    let layout = try XCTUnwrap(
      WordLoupeLayout(
        puzzle: open,
        selection: GridSelection(cell: 12, isAcross: true),
        camera: camera))

    XCTAssertEqual(layout.lens.minX, 2.8, accuracy: 0.001)
    XCTAssertEqual(layout.lens.minY, 156.8, accuracy: 0.001)
    XCTAssertEqual(layout.lens.width, 374.4, accuracy: 0.001)
    XCTAssertEqual(layout.lens.height, 86.4, accuracy: 0.001)
    XCTAssertEqual(layout.focus, CGRect(x: 154, y: 164, width: 72, height: 72))
  }

  func test_axisMorphNeverResizesOrMovesFocusSquare() throws {
    let across = try XCTUnwrap(
      WordLoupeLayout(
        puzzle: open,
        selection: GridSelection(cell: 12, isAcross: true),
        camera: camera))
    let down = try XCTUnwrap(
      WordLoupeLayout(
        puzzle: open,
        selection: GridSelection(cell: 12, isAcross: false),
        camera: camera))

    XCTAssertEqual(across.focus, down.focus)
    XCTAssertGreaterThan(across.lens.width, across.lens.height)
    XCTAssertGreaterThan(down.lens.height, down.lens.width)
  }

  func test_edgeAnswerOverflowsPastGridBounds() throws {
    let layout = try XCTUnwrap(
      WordLoupeLayout(
        puzzle: open,
        selection: GridSelection(cell: 0, isAcross: false),
        camera: GridCamera(scale: 1, offset: .zero)))

    XCTAssertLessThan(layout.lens.minX, 0)
    XCTAssertLessThan(layout.lens.minY, 0)
  }

  func test_blockHasNoLoupe() {
    let blocked = GridPuzzle(rows: 3, cols: 3, blocks: [4])
    XCTAssertNil(
      WordLoupeLayout(
        puzzle: blocked,
        selection: GridSelection(cell: 4, isAcross: true),
        camera: camera))
  }
}
