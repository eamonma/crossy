import { getNextCell } from './utils' // replace with your actual file path

describe('getNextCell function', () => {
  // prettier-ignore
  const grid = [
    'A', 'B', '.', 'D', 'E',
    'F', '.', 'H', 'I', 'J',
    'K', 'L', 'M', '.', 'O',
    'P', 'Q', 'R', 'S', 'T',
  ]

  const cols = 5
  const rows = 4

  test('should move to the next cell in the across direction', () => {
    const currentCell = 0
    const nextCell = getNextCell(
      grid,
      cols,
      rows,
      'across',
      currentCell,
      'more',
    )
    expect(nextCell).toBe(1)
  })

  test('should move to the previous cell in the across direction', () => {
    const currentCell = 1
    const nextCell = getNextCell(
      grid,
      cols,
      rows,
      'across',
      currentCell,
      'less',
    )
    expect(nextCell).toBe(0)
  })

  test('should move to next row', () => {
    const currentCell = 4 // last cell in the first row
    const nextCell = getNextCell(
      grid,
      cols,
      rows,
      'across',
      currentCell,
      'more',
    )
    expect(nextCell).toBe(currentCell + 1) // should stay at the current cell
  })

  test('should not move beyond grid boundaries going down', () => {
    const currentCell = 15 // last cell in the first column
    const nextCell = getNextCell(grid, cols, rows, 'down', currentCell, 'more')
    expect(nextCell).toBe(currentCell) // should stay at the current cell
  })

  test('should skip over blocked cells going across', () => {
    const currentCell = 1 // second cell in the first row
    const nextCell = getNextCell(
      grid,
      cols,
      rows,
      'across',
      currentCell,
      'more',
    )
    expect(nextCell).toBe(3) // should skip cell 2 which is blocked
  })

  test('should skip over blocked cells going down', () => {
    const currentCell = 1 // first cell in the second column
    const nextCell = getNextCell(grid, cols, rows, 'down', currentCell, 'more')
    expect(nextCell).toBe(11) // should skip cell 6 which is blocked
  })

  test('should not escape the word if canEscapeWord is false', () => {
    const currentCell = 0
    const nextCell = getNextCell(
      grid,
      cols,
      rows,
      'across',
      currentCell,
      'more',
      undefined,
      false,
    )
    expect(nextCell).toBe(1) // should not skip over blocked cell
  })

  test('should escape the word if canEscapeWord is true', () => {
    const currentCell = 1
    const nextCell = getNextCell(
      grid,
      cols,
      rows,
      'across',
      currentCell,
      'more',
      undefined,
      true,
    )
    expect(nextCell).toBe(3) // should skip over blocked cell
  })

  test('should handle an empty grid', () => {
    const emptyGrid: never[] = []
    const currentCell = 0
    const nextCell = getNextCell(emptyGrid, 0, 0, 'across', currentCell, 'more')
    expect(nextCell).toBe(currentCell) // should not move
  })

  test('should handle invalid currentCell', () => {
    const currentCell = -1
    const nextCell = getNextCell(
      grid,
      cols,
      rows,
      'across',
      currentCell,
      'more',
    )
    expect(nextCell).toBe(0) // should move to 0
  })
})
