'use client'
import React from 'react'

type Answers = {
  across: string[]
  down: string[]
}

type Clues = {
  across: string[]
  down: string[]
}

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

// const CrosswordGrid: React.FC<Props> = ({
//   crossword,
//   answers,
//   shouldShowNumbers = true,
//   highlights = [],
// }) => {
//   const ref = useRef<HTMLDivElement>(null)
//   console.log(ref)

//   return (
//     <div
//       ref={ref}
//       className={'grid border-4 border-black w-full max-h-full'}
//       style={{
//         gridTemplateColumns: `repeat(${crossword.size.cols}, 1fr)`,
//         gridTemplateRows: `repeat(${crossword.size.rows}, 1fr)`,
//         aspectRatio: `${crossword.size.cols}/${crossword.size.rows}`,
//       }}
//     >
//       {[...new Array(crossword.size.cols * crossword.size.rows)].map((_, i) => {
//         let backgroundColor = '#fff'
//         if (crossword.grid[i] === '.') backgroundColor = 'rgb(24 24 27)'
//         else if (Object.keys(highlights).includes(i.toString())) {
//           backgroundColor = highlights[i]
//         }
//         return (
//           <div
//             key={i}
//             className={
//               'relative flex items-center w-full h-full text-3xl font-normal border-neutral-400 border-opacity-60 border-[0.4px] text-zinc-800'
//             }
//             style={{
//               backgroundColor,
//             }}
//           >
//             {shouldShowNumbers && (
//               <div className="absolute p-0 m-0 font-semibold tracking-tighter text-[10px] leading-[10px] top-[1.2px] left-[2px]">
//                 {!!crossword.gridnums[i] && crossword.gridnums[i]}
//               </div>
//             )}
//             <div className="relative flex items-center justify-center w-full h-full top-1">
//               {answers[i] && crossword.grid[i] !== '.' && answers[i]}
//             </div>
//           </div>
//         )
//       })}
//     </div>
//   )
// }

const CrosswordGrid: React.FC<Props> = ({
  crossword,
  answers,
  shouldShowNumbers = true,
  highlights = [],
}) => {
  const cellSize = 38 // This can be adjusted for different cell sizes
  const width = crossword.size.cols * cellSize
  const height = crossword.size.rows * cellSize

  // get browser

  return (
    <div
      style={{
        aspectRatio: `${crossword.size.cols}/${crossword.size.rows}`,
      }}
      className="relative w-full h-full flex-1 flex justify-center"
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
            let backgroundColor = 'rgba(255,255,255,0.9)'
            if (crossword.grid[i] === '.') {
              backgroundColor = 'rgba(0,0,0,0.8)'
            } else if (Object.keys(highlights).includes(i.toString())) {
              backgroundColor = highlights[i]
            }

            const row = Math.floor(i / crossword.size.cols)
            const col = i % crossword.size.cols

            return (
              <g
                onClick={() => {
                  alert(i)
                }}
                key={i}
              >
                <rect
                  x={col * cellSize}
                  y={row * cellSize}
                  width={cellSize}
                  height={cellSize}
                  fill={backgroundColor}
                  stroke="rgba(0,0,0,0.3)"
                  strokeWidth={0.6}
                />
                {shouldShowNumbers && crossword.gridnums[i] && (
                  <text
                    x={col * cellSize + 2}
                    y={row * cellSize + 10}
                    fontSize={10}
                    fontWeight="bold"
                  >
                    {crossword.gridnums[i]}
                  </text>
                )}
                {answers[i] && crossword.grid[i] !== '.' && (
                  <text
                    x={col * cellSize + cellSize / 2}
                    y={row * cellSize + cellSize / 2 + 12}
                    textAnchor="middle"
                    fontSize={24}
                    fill="black"
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
