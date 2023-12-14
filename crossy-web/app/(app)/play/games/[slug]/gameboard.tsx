'use client'
import React, { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'

import {
  findBounds,
  getNextCell as _getNextCell,
  getNextWord,
} from './utils'

type Size = {
  cols: number
  rows: number
}

export type Clues = {
  across: string[]
  down: string[]
}

export type CrosswordData = {
  clues: Clues
  grid: string[]
  gridnums: number[]
  size: Size
  id?: string
}

type Props = {
  updateGridItem: (
    index: number,
    value: string | null,
    ack?: () => void,
  ) => void
  crosswordData: CrosswordData
  currentCell: number
  setCurrentCell: (i: number) => void
  currentDirection: 'across' | 'down'
  setCurrentDirection: React.Dispatch<React.SetStateAction<'across' | 'down'>>
  setClueNum: React.Dispatch<React.SetStateAction<number>>
  highlights?: Record<number, string>
  setHighlights?: React.Dispatch<React.SetStateAction<Record<number, string>>>
  friendsLocations?: Record<string, number>
  gameboardRef: React.RefObject<SVGSVGElement>
  remoteAnswers: string[]
  gameIsOngoing: boolean
  answers: string[]
  setAnswers: React.Dispatch<React.SetStateAction<string[]>>
  claimComplete: () => void
}

const Gameboard: React.FC<Props> = ({
  updateGridItem,
  crosswordData,
  currentCell,
  setCurrentCell,
  currentDirection,
  setCurrentDirection,
  setClueNum,
  highlights,
  setHighlights,
  gameboardRef,
  friendsLocations,
  remoteAnswers,
  gameIsOngoing,
  claimComplete,
  answers,
  setAnswers,
}) => {
  const [currentTheme, setCurrentTheme] = useState<'light' | 'dark'>('dark')
  const { resolvedTheme } = useTheme()
  const cellHighlights = highlights ?? {}

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

  const cellSize = 36 // This can be adjusted for different cell sizes
  const width = crosswordData.size.cols * cellSize
  const height = crosswordData.size.rows * cellSize

  const handleCellClick = (i: number) => {
    if (crosswordData.grid[i] === '.') return
    setCurrentCell(i)

    if (currentCell === i) {
      toggleDirection()
    }
  }

  const bounds = findBounds(
    crosswordData.grid,
    crosswordData.size.cols,
    crosswordData.size.rows,
    currentDirection,
    currentCell,
    crosswordData.id,
  )

  const inputHighlights: Record<number, boolean> = {}
  const stride = currentDirection === 'across' ? 1 : crosswordData.size.cols

  for (let i = bounds[0]; i <= bounds[1]; i += stride) {
    inputHighlights[i] = true
  }

  const anticipated = useRef(0)

  useEffect(() => {
    if (anticipated.current < 0) anticipated.current = 0
    if (anticipated.current > 0) return
    setAnswers(remoteAnswers)
  }, [remoteAnswers, setAnswers])

  const claimed = useRef(false)

  useEffect(() => {
    if (!gameIsOngoing) return
    if (claimed.current) return
    for (let i = 0; i < crosswordData.grid.length; i++) {
      if (crosswordData.grid[i] === '.') continue
      if (crosswordData.grid[i] !== answers[i]) return
    }
    claimComplete()
    claimed.current = true
  }, [answers, gameIsOngoing, claimComplete, crosswordData.grid])

  const getNextCell = (
    direction: 'across' | 'down',
    from: number,
    towards?: 'more' | 'less',
    answers?: string[],
    canEscapeWord?: boolean,
  ) => {
    return _getNextCell(
      crosswordData.grid,
      crosswordData.size.cols,
      crosswordData.size.rows,
      direction,
      from,
      towards,
      answers,
      canEscapeWord,
    )
  }

  const handleSetCell = (
    i: number,
    value: string,
    e?: KeyboardEvent<SVGElement>,
  ) => {
    let nextCell = currentCell
    const ack = () => {
      anticipated.current -= 1
    }

    if (value === 'ArrowRight') {
      if (currentDirection === 'across') {
        nextCell = getNextCell('across', currentCell)
        setCurrentCell(nextCell)
      } else {
        toggleDirection()
      }
    } else if (value === 'ArrowLeft') {
      if (currentDirection === 'across') {
        nextCell = getNextCell('across', currentCell, 'less')
        setCurrentCell(nextCell)
      } else {
        toggleDirection()
      }
    } else if (value === 'ArrowDown') {
      if (currentDirection === 'down') {
        nextCell = getNextCell('down', currentCell)
        setCurrentCell(nextCell)
      } else {
        toggleDirection()
      }
    } else if (value === 'ArrowUp') {
      if (currentDirection === 'down') {
        nextCell = getNextCell('down', currentCell, 'less')
        setCurrentCell(nextCell)
      } else {
        toggleDirection()
      }
    } else if (value === 'Tab') {
      const towards = e?.shiftKey ? 'less' : 'more'

      nextCell = getNextWord(
        crosswordData.clues,
        crosswordData.grid,
        crosswordData.gridnums,
        crosswordData.size.cols,
        crosswordData.size.rows,
        currentDirection,
        currentCell,
        towards,
      )

      const originalNextCell = nextCell
      // move to first empty letter within word, if word is full, move to start
      while (answers[nextCell]) {
        nextCell = getNextCell(
          currentDirection,
          nextCell,
          'more',
          undefined,
          false,
        )
        if (crosswordData.grid[nextCell] === '.') {
          const [left] = findBounds(
            crosswordData.grid,
            crosswordData.size.cols,
            crosswordData.size.rows,
            currentDirection,
            originalNextCell,
            crosswordData.id,
          )

          nextCell = left
          break
        }
      }

      setCurrentCell(nextCell)
    }

    if (!gameIsOngoing) return
    if (['Backspace', 'Delete', 'del'].includes(value)) {
      const isPrevEmpty = answers[i] === '' || !answers[i]

      const newAnswers = [...answers]
      newAnswers[i] = ''
      setHighlights?.((prev) => {
        const newHighlights = { ...prev }
        delete newHighlights[i]
        return newHighlights
      })

      anticipated.current += 1
      updateGridItem(i, null, ack)

      if (isPrevEmpty) {
        // move to previous cell
        nextCell = getNextCell(currentDirection, i, 'less')

        newAnswers[nextCell] = ''
        setHighlights?.((prev) => {
          const newHighlights = { ...prev }
          delete newHighlights[nextCell]
          return newHighlights
        })

        anticipated.current += 1
        updateGridItem(nextCell, null, ack)
      }

      setCurrentCell(nextCell)
      setAnswers(newAnswers)
    } else if (value.length === 1 && value.match(/[a-z0-9]/i)) {
      const newAnswers = [...answers]
      newAnswers[i] = value.toUpperCase()

      setAnswers(newAnswers)
      setHighlights?.((prev) => {
        const newHighlights = { ...prev }
        delete newHighlights[i]
        return newHighlights
      })

      let nextCell = getNextCell(currentDirection, i, 'more', newAnswers)

      // if we're at the end of a word, move to either
      // - the beginning if the word is incomplete
      // - the end if the word is complete (don't move)
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

      anticipated.current += 1
      updateGridItem(i, value.toUpperCase(), ack)
    }
  }

  useEffect(() => {
    const bounds = findBounds(
      crosswordData.grid,
      crosswordData.size.cols,
      crosswordData.size.rows,
      currentDirection,
      currentCell,
      crosswordData.id,
    )

    setClueNum(crosswordData.gridnums[bounds[0]])
  }, [currentCell, setClueNum, crosswordData, currentDirection])

  const blackSquareColour =
    currentTheme === 'dark' ? 'var(--gray-1)' : 'var(--gray-12)'
  const defaultColour =
    currentTheme === 'dark' ? 'var(--gray-3)' : 'var(--gray-1)'
  const currentCellColour =
    currentTheme === 'dark' ? 'var(--blue-6)' : 'var(--yellow-5)'
  const currentClueColour =
    currentTheme === 'dark' ? 'var(--violet-3)' : 'var(--blue-4)'
  const friendIsHereColour =
    currentTheme === 'dark' ? 'var(--crimson-8)' : 'var(--crimson-5)'

  const friendsCellNumbers = Object.values(friendsLocations ?? {})

  return (
    <div
      style={{
        aspectRatio: `${crosswordData.size.cols}/${crosswordData.size.rows}`,
      }}
      className="relative flex justify-center flex-1 w-full h-full"
    >
      <svg
        ref={gameboardRef}
        tabIndex={0}
        onKeyDownCapture={(e) => {
          if (e.metaKey || e.ctrlKey) return
          e.preventDefault()
          handleSetCell(currentCell, e.key, e)
        }}
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMin meet"
        className="border-2 outline-none"
        style={{
          aspectRatio: `${crosswordData.size.cols}/${crosswordData.size.rows}`,
        }}
      >
        {crosswordData.grid.map((gridItem, i) => {
          let backgroundColor = defaultColour
          if (gridItem === '.') {
            backgroundColor = blackSquareColour
          } else if (i === currentCell) {
            backgroundColor = currentCellColour
          } else if (i in cellHighlights) {
            backgroundColor = cellHighlights[i]
          } else if (friendsCellNumbers.includes(i)) {
            backgroundColor = friendIsHereColour
          } else if (inputHighlights[i]) {
            backgroundColor = currentClueColour
          }

          const row = Math.floor(i / crosswordData.size.cols)
          const col = i % crosswordData.size.cols

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
              {crosswordData.gridnums[i] && (
                <text
                  x={col * cellSize + 2}
                  y={row * cellSize + 10}
                  fontSize={10}
                  fontWeight="bold"
                  fill="var(--gray-11)"
                  className="select-none"
                >
                  {crosswordData.gridnums[i]}
                </text>
              )}
              {/* Friend-is-here indicator */}
              {friendsCellNumbers.includes(i) && (
                <circle
                  cx={col * cellSize + cellSize - 6}
                  cy={row * cellSize + 6}
                  r={2.5}
                  fill="var(--indigo-9)"
                  className="select-none"
                />
              )}
              {/* Answer of cell */}
              {answers[i] && crosswordData.grid[i] !== '.' && (
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
