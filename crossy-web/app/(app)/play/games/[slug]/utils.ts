import { LRUCache } from 'lru-cache'

import { type Clues } from './gameboard'

export const getNextCell = (
  // puzzle: CrosswordData,
  grid: string[],
  cols: number,
  rows: number,
  currentDirection: 'across' | 'down',
  currentCell: number,
  direction: 'less' | 'more' = 'more',
  answers?: string[],
  canEscapeWord: boolean = true,
) => {
  const stride = currentDirection === 'across' ? 1 : cols
  const incrementor = direction === 'more' ? stride : -stride

  let nextCell = currentCell + incrementor

  if (!canEscapeWord) {
    return nextCell
  }

  const puzzleSize = cols * rows

  while (grid[nextCell] === '.') {
    nextCell += incrementor
  }

  if (answers && direction === 'more') {
    const cellAfterIfWholeWordIsFull = nextCell
    while (answers[nextCell]) {
      nextCell += incrementor
    }

    if (grid[nextCell] === '.') {
      nextCell = cellAfterIfWholeWordIsFull
    }
  }

  if (nextCell >= puzzleSize || nextCell < 0) {
    nextCell = currentCell
  }

  return nextCell
}

export const getNextWord = (
  clues: Clues,
  grid: string[],
  gridnums: number[],
  cols: number,
  rows: number,
  currentDirection: 'across' | 'down',
  currentSquare: number,
  direction: 'less' | 'more' = 'more',
) => {
  const [start] = findBounds(grid, cols, rows, currentDirection, currentSquare)
  const currentNumber = gridnums[start]

  const index = clues[currentDirection].findIndex(
    (clue) => clue.split('.')[0] === currentNumber.toString(),
  )

  const nextIndex = direction === 'more' ? index + 1 : index - 1

  if (nextIndex < 0 || nextIndex >= clues[currentDirection].length) {
    return grid.findIndex((cell) => cell !== '.')
  }

  const nextNumber = Number(clues[currentDirection][nextIndex].split('.')[0])

  return gridnums.findIndex((num) => num === nextNumber)
}

const cache = new LRUCache<string, [number, number]>({ max: 500 })

export const findBounds = (
  grid: string[],
  cols: number,
  rows: number,
  direction: 'across' | 'down',
  currentCell: number,
  id?: string,
): [number, number] => {
  let key

  if (id) {
    key = `${id}-${direction}-${currentCell}`
  } else {
    key = `${grid.join('')}-${cols}-${rows}-${direction}-${currentCell}`
  }

  if (cache.has(key)) {
    return cache.get(key) as [number, number]
  }

  const startingSubset = grid.slice(0, currentCell + 1)
  const endingSubset = grid.slice(currentCell)

  let start = 0
  let end = 0
  // Go until find a .
  if (direction === 'across') {
    for (let i = startingSubset.length - 1; i >= 0; i--) {
      if (startingSubset[i] === '.') {
        start = i + 1
        break
      }

      if (i % cols === 0) {
        start = i
        break
      }
    }

    for (let i = 0; i < endingSubset.length; i++) {
      if (endingSubset[i] === '.') {
        end = i + startingSubset.length - 2
        break
      }

      if ((i + startingSubset.length) % cols === 0) {
        end = i + startingSubset.length - 1
        break
      }
    }
  } else if (direction === 'down') {
    for (let i = startingSubset.length - 1; i >= 0; i -= cols) {
      if (startingSubset[i] === '.') {
        start = i + cols
        break
      }

      if (i < cols) {
        start = i
        break
      }
    }

    for (let i = 0; i < endingSubset.length; i += cols) {
      if (endingSubset[i] === '.') {
        end = i + startingSubset.length - cols - 1
        break
      }

      if (i + startingSubset.length - 1 >= cols * (rows - 1)) {
        end = i + startingSubset.length - 1
      }
    }
  }

  cache.set(key, [start, end])

  return [start, end]
}
