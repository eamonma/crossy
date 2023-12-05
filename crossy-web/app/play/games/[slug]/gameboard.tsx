'use client'
import React, { type KeyboardEvent, useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Database } from '@/lib/database.types'
import { createClient } from '@/utils/supabase/client'

type Size = {
  cols: number
  rows: number
}

type Clues = {
  across: string[]
  down: string[]
}

export type CrosswordData = {
  // answers: Answers
  // author: string
  clues: Clues
  grid: string[]
  gridnums: number[]
  // date: string
  size: Size
}

export const getNextCell = (
  // puzzle: CrosswordData,
  grid: string[],
  cols: number,
  rows: number,
  currentDirection: 'across' | 'down',
  currentCell: number,
  direction: 'less' | 'more' = 'more',
) => {
  const stride = currentDirection === 'across' ? 1 : cols
  const incrementor = direction === 'more' ? stride : -stride

  let nextCell = currentCell + incrementor

  const puzzleSize = cols * rows

  while (grid[nextCell] === '.') {
    nextCell += incrementor
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

export const findBounds = (
  grid: string[],
  cols: number,
  rows: number,
  direction: 'across' | 'down',
  currentCell: number,
): [number, number] => {
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

  return [start, end]
}

type Props = {
  game: Database['public']['Tables']['games']['Row']
  crossword: CrosswordData
  currentCell: number
  setCurrentCell: (i: number) => void
  currentDirection: 'across' | 'down'
  setCurrentDirection: (direction: 'across' | 'down') => void
  setCurrentClueNum: (num: number) => void
  shouldShowNumbers?: boolean
  highlights?: Record<number, string>
  highlightColour?: string
  rounded?: boolean
  boardRef: React.RefObject<SVGElement>
}
const Gameboard: React.FC<Props> = ({
  game,
  crossword,
  currentCell,
  setCurrentCell,
  currentDirection,
  setCurrentDirection,
  setCurrentClueNum,
  boardRef,
  shouldShowNumbers = true,
  // highlights = [],
}) => {
  const supabase = createClient<Database>()
  const [answers, setAnswers] = useState<string[]>(game.grid)
  // const [currentCell, setCurrentCell] = useState<number>(0)

  const toggleDirection = () => {
    setCurrentDirection((prev) => (prev === 'across' ? 'down' : 'across'))
  }

  const [highlights, setHighlights] = useState<Record<number, string>>({})
  const cellSize = 36 // This can be adjusted for different cell sizes
  const width = crossword.size.cols * cellSize
  const height = crossword.size.rows * cellSize

  const handleCellClick = (i: number) => {
    if (crossword.grid[i] === '.') return
    setCurrentCell(i)

    if (currentCell === i) {
      toggleDirection()
    }
  }

  const bounds = findBounds(
    crossword.grid,
    crossword.size.cols,
    crossword.size.rows,
    currentDirection,
    currentCell,
  )

  const inputHighlights: Record<number, boolean> = {}
  const stride = currentDirection === 'across' ? 1 : crossword.size.cols

  for (let i = bounds[0]; i <= bounds[1]; i += stride) {
    inputHighlights[i] = true
  }

  const room = supabase.channel(game.id, {
    config: {
      broadcast: {
        ack: true,
      },
    },
  }) // set your topic here

  // const changes = supabase
  //   .channel('table-db-changes')
  //   .on(
  //     'postgres_changes',
  //     {
  //       event: '*',
  //       schema: 'public',
  //       table: 'games',
  //     },
  //     (payload) => {
  //       const {
  //         new: { grid },
  //       } = payload
  //       setAnswers(grid)
  //     },
  //     // console.log(payload),
  //   )
  //   .subscribe()

  // useEffect(() => {
  //   if (room)
  room
    .on('broadcast', { event: 'update_grid_element' }, (res) => {
      const { payload } = res
      const { grid_index, new_value } = payload
      const newAnswers = [...answers]
      newAnswers[grid_index] = new_value
      setAnswers(newAnswers)
    })
    .subscribe()

  //   return async () => {
  //     await room.unsubscribe()
  //   }
  // }, [answers, room, supabase])
  // const ref = useRef<SVGElement>(null)

  const handleSetCell = (
    i: number,
    value: string,
    e?: KeyboardEvent<SVGElement>,
  ) => {
    if (value.length === 1 && value.match(/[a-z0-9]/i)) {
      const newAnswers = [...answers]
      newAnswers[i] = value.toUpperCase()
      void supabase
        .rpc('update_grid_element', {
          game_id: game.id,
          grid_index: i,
          new_value: value.toUpperCase(),
        })
        .then((res) => {
          console.log(res)
        })

      void room
        .send({
          type: 'broadcast',
          event: 'update_grid_element',
          payload: {
            game_id: game.id,
            grid_index: i,
            new_value: value.toUpperCase(),
          },
        })
        .then((res) => {
          console.log(res)
        })

      setAnswers(newAnswers)

      let nextCell = getNextCell(
        crossword.grid,
        crossword.size.cols,
        crossword.size.rows,
        currentDirection,
        i,
      )

      if (nextCell > bounds[1]) {
        const answerForCurrentWord = []
        for (let i = bounds[0]; i <= bounds[1]; i += stride) {
          if (newAnswers[i]) answerForCurrentWord.push(newAnswers[i])
        }
        console.log(answerForCurrentWord)

        if (answerForCurrentWord.length < bounds[1] - bounds[0] + 1) {
          nextCell = bounds[0]
        } else {
          nextCell = bounds[1]
        }
      }

      setCurrentCell(nextCell)
      return
    }

    let nextCell = currentCell

    if (['Backspace', 'Delete'].includes(value)) {
      const prev = answers[i]
      setAnswers((prev) => {
        const newAnswers = [...prev]
        newAnswers[i] = ''
        return newAnswers
      })
      void supabase
        .rpc('update_grid_element', {
          game_id: game.id,
          grid_index: i,
          new_value: null as unknown as string,
        })
        .then((res) => {
          console.log(res)
        })

      void room
        .send({
          type: 'broadcast',
          event: 'update_grid_element',
          payload: {
            game_id: game.id,
            grid_index: i,
            new_value: null as unknown as string,
          },
        })
        .then((res) => {})

      if (prev) return
      // move to previous cell
      nextCell = getNextCell(
        crossword.grid,
        crossword.size.cols,
        crossword.size.rows,
        currentDirection,
        i,
        'less',
      )
    } else if (value === 'ArrowRight') {
      if (currentDirection === 'across') {
        nextCell = getNextCell(
          crossword.grid,
          crossword.size.cols,
          crossword.size.rows,
          'across',
          currentCell,
        )
      } else {
        toggleDirection()
      }
    } else if (value === 'ArrowLeft') {
      if (currentDirection === 'across') {
        nextCell = getNextCell(
          crossword.grid,
          crossword.size.cols,
          crossword.size.rows,
          'across',
          currentCell,
          'less',
        )
      } else {
        toggleDirection()
      }
    } else if (value === 'ArrowDown') {
      if (currentDirection === 'down') {
        nextCell = getNextCell(
          crossword.grid,
          crossword.size.cols,
          crossword.size.rows,
          'down',
          currentCell,
        )
      } else {
        toggleDirection()
      }
    } else if (value === 'ArrowUp') {
      if (currentDirection === 'down') {
        nextCell = getNextCell(
          crossword.grid,
          crossword.size.cols,
          crossword.size.rows,
          'down',
          currentCell,
          'less',
        )
      } else {
        toggleDirection()
      }
    } else if (value === 'Tab') {
      nextCell = getNextWord(
        crossword.clues,
        crossword.grid,
        crossword.gridnums,
        crossword.size.cols,
        crossword.size.rows,
        currentDirection,
        currentCell,
        e?.shiftKey ? 'less' : 'more',
      )
    }
    setCurrentCell(nextCell)
  }

  const [currentTheme, setCurrentTheme] = useState<'light' | 'dark'>('light')
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    if (resolvedTheme === 'dark') {
      setCurrentTheme('dark')
    } else {
      setCurrentTheme('light')
    }
  }, [resolvedTheme, setCurrentTheme])

  useEffect(() => {
    const bounds = findBounds(
      crossword.grid,
      crossword.size.cols,
      crossword.size.rows,
      currentDirection,
      currentCell,
    )

    setCurrentClueNum(crossword.gridnums[bounds[0]])
  }, [currentCell, setCurrentClueNum, crossword, currentDirection])

  const blackSquareColour =
    currentTheme === 'dark' ? 'var(--gray-1)' : 'var(--gray-12)'
  const defaultColour =
    currentTheme === 'dark' ? 'var(--gray-3)' : 'var(--gray-1)'
  const currentCellColour =
    currentTheme === 'dark' ? 'var(--blue-6)' : 'var(--yellow-5)'
  const currentClueColour =
    currentTheme === 'dark' ? 'var(--violet-3)' : 'var(--blue-4)'

  return (
    <div
      style={{
        aspectRatio: `${crossword.size.cols}/${crossword.size.rows}`,
      }}
      className="relative flex justify-center flex-1 w-full h-full"
    >
      <svg
        ref={boardRef}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.metaKey || e.ctrlKey) return
          e.preventDefault()
          handleSetCell(currentCell, e.key, e)
        }}
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMin meet"
        className="border-2 outline-none"
        style={{
          aspectRatio: `${crossword.size.cols}/${crossword.size.rows}`,
        }}
      >
        {crossword.grid.map((gridItem, i) => {
          // let backgroundColor = 'rgba(255,255,255,0.9)'
          let backgroundColor = defaultColour
          if (gridItem === '.') {
            backgroundColor = blackSquareColour
          } else if (Object.keys(highlights).includes(i.toString())) {
            backgroundColor = highlights[i]
          } else if (i === currentCell) {
            backgroundColor = currentCellColour
          } else if (inputHighlights[i]) {
            backgroundColor = currentClueColour
          }

          const row = Math.floor(i / crossword.size.cols)
          const col = i % crossword.size.cols

          const handleMouseDown = () => {
            handleCellClick(i)
          }

          return (
            <g onMouseDown={handleMouseDown} key={i}>
              <rect
                x={col * cellSize}
                y={row * cellSize}
                width={cellSize}
                height={cellSize}
                fill={backgroundColor}
                stroke="var(--gray-8)"
                strokeWidth={0.6}
              />
              {shouldShowNumbers && crossword.gridnums[i] && (
                <>
                  <text
                    x={col * cellSize + 2}
                    y={row * cellSize + 10}
                    fontSize={10}
                    fontWeight="bold"
                    fill="var(--gray-11)"
                  >
                    {crossword.gridnums[i]}
                  </text>
                </>
              )}
              {answers[i] && crossword.grid[i] !== '.' && (
                <text
                  x={col * cellSize + cellSize / 2}
                  y={row * cellSize + cellSize / 2 + 14}
                  textAnchor="middle"
                  fontSize={24}
                  fill="var(--gray-12)"
                >
                  {answers[i]}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export default Gameboard
