'use client'
import React from 'react'

type Size = {
  cols: number
  rows: number
}

export type CrosswordData = {
  // answers: Answers
  // author: string
  // clues: Clues
  grid: string[]
  gridnums: number[]
  // date: string
  size: Size
}

type Props = {
  crossword: CrosswordData
  answers: string[]
  shouldShowNumbers?: boolean
  highlights?: Record<number, string>
  highlightColour?: string
  rounded?: boolean
}

const CrosswordGrid: React.FC<Props> = ({
  crossword,
  answers,
  shouldShowNumbers = true,
  highlights = [],
}) => {
  const cellSize = 36 // This can be adjusted for different cell sizes
  const width = crossword.size.cols * cellSize
  const height = crossword.size.rows * cellSize

  return (
    <div
      style={{
        aspectRatio: `${crossword.size.cols}/${crossword.size.rows}`,
      }}
      className="relative flex justify-center flex-1 w-full h-full"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMin meet"
        className="border-2"
        style={{
          aspectRatio: `${crossword.size.cols}/${crossword.size.rows}`,
        }}
      >
        {[...new Array(crossword.size.cols * crossword.size.rows)].map(
          (_, i) => {
            // let backgroundColor = 'rgba(255,255,255,0.9)'
            let backgroundColor = 'var(--gray-1)'
            if (crossword.grid[i] === '.') {
              // backgroundColor = 'rgba(0,0,0,0.8)'
              backgroundColor = 'var(--gray-12)'
            } else if (Object.keys(highlights).includes(i.toString())) {
              backgroundColor = highlights[i]
            }

            const row = Math.floor(i / crossword.size.cols)
            const col = i % crossword.size.cols

            return (
              <g key={i}>
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
          },
        )}
      </svg>
    </div>
  )
}

export default CrosswordGrid
