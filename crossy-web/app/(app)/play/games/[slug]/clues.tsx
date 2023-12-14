import React, { useRef } from 'react'
import { Text } from '@radix-ui/themes'
import parse from 'html-react-parser'

import { type CrosswordData } from './gameboard'
import { findBounds } from './utils'

type Props = {
  crosswordData: CrosswordData
  currentCell: number
  setCurrentCell: React.Dispatch<React.SetStateAction<number>>
  currentDirection: 'across' | 'down'
  setCurrentDirection: React.Dispatch<React.SetStateAction<'across' | 'down'>>
  setClueNum: React.Dispatch<React.SetStateAction<number>>
  gameboardRef: React.RefObject<SVGSVGElement>
  shouldScrollSmoothly: boolean
  answers: string[]
  direction: 'across' | 'down'
}

const Clues: React.FC<Props> = ({
  crosswordData,
  currentCell,
  setCurrentCell,
  currentDirection,
  setCurrentDirection,
  setClueNum,
  gameboardRef,
  answers,
  direction,
  shouldScrollSmoothly,
}) => {
  const listRef = useRef<Array<HTMLLIElement | null>>([])
  const bounds = findBounds(
    crosswordData.grid,
    crosswordData.size.cols,
    crosswordData.size.rows,
    direction,
    currentCell,
    crosswordData.id,
  )

  const clueNum = crosswordData.gridnums[bounds[0]] ?? 0

  listRef.current?.[clueNum]?.scrollIntoView({
    behavior: shouldScrollSmoothly ? 'smooth' : 'instant',
    block: 'start',
  })

  return (
    <>
      <div className="select-none">
        <div className="px-6 py-2 font-serif font-bold">
          {direction.charAt(0).toUpperCase() + direction.slice(1)}
        </div>
        <hr className="border-dashed" />
      </div>
      <ul className="flex flex-col flex-1 h-full overflow-y-auto select-none scrollbar-thin">
        {crosswordData.clues[direction].map((clue) => {
          const clueNum = parseInt(clue.substring(0, clue.indexOf('. ')))

          const boundsForClue = findBounds(
            crosswordData.grid,
            crosswordData.size.cols,
            crosswordData.size.rows,
            direction,
            crosswordData.gridnums.indexOf(clueNum),
            crosswordData.id,
          )

          let squareIsWithinClueBounds
          const clueIsFilled = false

          const items =
            Math.ceil(
              (boundsForClue[1] - boundsForClue[0]) / crosswordData.size.cols,
            ) + 1

          if (direction === 'across') {
            squareIsWithinClueBounds =
              currentCell >= boundsForClue[0] && currentCell <= boundsForClue[1]
          } else {
            const squaresWithinClueBounds = [boundsForClue[0]]

            for (let j = 1; j < items; j++) {
              squaresWithinClueBounds.push(
                boundsForClue[0] + j * crosswordData.size.cols,
              )
            }

            squareIsWithinClueBounds =
              squaresWithinClueBounds.includes(currentCell)
          }

          let bg
          if (squareIsWithinClueBounds) {
            if (currentDirection === direction) {
              bg = 'bg-[var(--amber-5)]'
            } else {
              bg = 'bg-[var(--amber-3)]'
            }
          }

          return (
            <li
              key={clueNum}
              className="grid grid-cols-[5ch,1fr] cursor-pointer bg-opacity-30"
              onClick={() => {
                setCurrentDirection(direction)
                setClueNum(clueNum)
                setCurrentCell(crosswordData.gridnums.indexOf(clueNum))
                gameboardRef.current?.focus()
              }}
              ref={(ref) => {
                if (listRef.current) listRef.current[clueNum] = ref
              }}
            >
              <Text className={`py-1 pr-2 text-right ${bg}`}>{clueNum}</Text>
              <Text
                className={`py-1 pl-4 ${currentDirection === direction && bg} ${
                  clueIsFilled && 'text-[var(--gray-11)] line-through'
                }`}
              >
                {parse(`${clue.substring(clue.indexOf(' '))}`)}
              </Text>
            </li>
          )
        })}
      </ul>
    </>
  )
}

export default Clues
