'use client'
import React, { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import {
  type RealtimePostgresChangesPayload,
  type RealtimePostgresUpdatePayload,
} from '@supabase/supabase-js'
import { useTheme } from 'next-themes'

import { type Database } from '@/lib/database.types'
import { createClient } from '@/utils/supabase/client'

import { findBounds, getNextCell, getNextWord } from './utils'

type Size = {
  cols: number
  rows: number
}

export type Clues = {
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
  id?: string
}

function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let timer: NodeJS.Timeout | null = null

  return (...args: Parameters<T>) => {
    if (timer) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => {
      func(...args)
    }, delay)
  }
}

type Props = {
  game: Database['public']['Tables']['games']['Row']
  crossword: CrosswordData
  currentCell: number
  setCurrentCell: (i: number) => void
  currentDirection: 'across' | 'down'
  setCurrentDirection: React.Dispatch<React.SetStateAction<'across' | 'down'>>
  setCurrentClueNum: (num: number) => void
  shouldShowNumbers?: boolean
  highlights?: Record<number, string>
  highlightColour?: string
  rounded?: boolean
  boardRef: React.RefObject<SVGSVGElement>
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
}) => {
  const supabase = createClient<Database>()
  const [answers, setAnswers] = useState<string[]>(game.grid)
  const [currentTheme, setCurrentTheme] = useState<'light' | 'dark'>('dark')
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    if (resolvedTheme === 'dark') {
      setCurrentTheme('dark')
    } else {
      setCurrentTheme('light')
    }
  }, [resolvedTheme, setCurrentTheme])

  const toggleDirection = () => {
    setCurrentDirection((prev) => (prev === 'across' ? 'down' : 'across'))
  }

  const [highlights] = useState<Record<number, string>>({})
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
    crossword.id,
  )

  const inputHighlights: Record<number, boolean> = {}
  const stride = currentDirection === 'across' ? 1 : crossword.size.cols

  for (let i = bounds[0]; i <= bounds[1]; i += stride) {
    inputHighlights[i] = true
  }

  // const room = supabase.channel(game.id, {
  //   config: {
  //     broadcast: {
  //       ack: true,
  //     },
  //   },
  // }) // set your topic here
  const isUpdating = useRef(false)

  useEffect(() => {
    const handleChange = debounce(
      (
        payload: RealtimePostgresChangesPayload<Record<string, any>>,
      ) => {
        console.log(payload)
        if (!payload) return
        const { new: newState } = payload as RealtimePostgresUpdatePayload<Record<string, any>>

        const grid = newState.grid
        setAnswers(grid)
      },
      200,
    )

    const changes = supabase
      .channel('table-db-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'games',
        },
        handleChange,
      )
      .subscribe()

    return () => {
      void changes.unsubscribe()
    }
  }, [supabase])

  // room
  //   .on('broadcast', { event: 'update_grid_element' }, (res) => {
  //     const { payload } = res
  //     const { grid_index: gridIndex, new_value: newValue } = payload
  //     const newAnswers = [...answers]

  //     newAnswers[gridIndex] = newValue
  //     setAnswers(newAnswers)
  //   })
  //   .subscribe()

  const handleSetCell = (
    i: number,
    value: string,
    e?: KeyboardEvent<SVGElement>,
  ) => {
    if (value.length === 1 && value.match(/[a-z0-9]/i)) {
      const newAnswers = [...answers]
      newAnswers[i] = value.toUpperCase()

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

        if (answerForCurrentWord.length < bounds[1] - bounds[0] + 1) {
          nextCell = bounds[0]
        } else {
          nextCell = bounds[1]
        }
      }

      setCurrentCell(nextCell)
      isUpdating.current = true

      void supabase
        .rpc('update_grid_element', {
          game_id: game.id,
          grid_index: i,
          new_value: value.toUpperCase(),
        })
        .then((res) => {
          console.log(res)
        })

      // void room
      //   .send({
      //     type: 'broadcast',
      //     event: 'update_grid_element',
      //     payload: {
      //       game_id: game.id,
      //       grid_index: i,
      //       new_value: value.toUpperCase(),
      //       // grid: newAnswers,
      //     },
      //   })
      //   .then((res) => {})
      return
    }

    let nextCell = currentCell

    if (['Backspace', 'Delete'].includes(value)) {
      const prev = answers[i]
      const newAnswers = [...answers]
      newAnswers[i] = ''
      setAnswers(newAnswers)
      isUpdating.current = true

      if (!prev) {
        // move to previous cell
        nextCell = getNextCell(
          crossword.grid,
          crossword.size.cols,
          crossword.size.rows,
          currentDirection,
          i,
          'less',
        )
      }

      void supabase
        .rpc('update_grid_element', {
          game_id: game.id,
          grid_index: i,
          new_value: null as unknown as string,
        })
        .then((res) => {
          console.log(res)
        })

      // void room
      //   .send({
      //     type: 'broadcast',
      //     event: 'update_grid_element',
      //     payload: {
      //       game_id: game.id,
      //       grid_index: i,
      //       new_value: null as unknown as string,
      //       // grid: newAnswers,
      //     },
      //   })
      //   .then((res) => {})
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

  useEffect(() => {
    const bounds = findBounds(
      crossword.grid,
      crossword.size.cols,
      crossword.size.rows,
      currentDirection,
      currentCell,
      crossword.id,
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
                    className="select-none"
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
                  className="select-none"
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
