import { Heading, Text } from '@radix-ui/themes'
import parse from 'html-react-parser'
import React from 'react'
import { findBounds } from './utils'
import { CrosswordData } from './gameboard'

type Props = {
  crosswordData: CrosswordData
  currentCell: number
  setCurrentCell: React.Dispatch<React.SetStateAction<number>>
  currentDirection: 'across' | 'down'
  setCurrentDirection: React.Dispatch<React.SetStateAction<'across' | 'down'>>
  setClueNum: React.Dispatch<React.SetStateAction<number>>
  gameboardRef: React.RefObject<SVGSVGElement>
  listRef: React.RefObject<Array<HTMLLIElement | null>>
  direction: 'across' | 'down'
}

const Clues = ({
  crosswordData,
  currentCell,
  setCurrentCell,
  currentDirection,
  setCurrentDirection,
  setClueNum,
  gameboardRef,
  listRef,
  direction,
}: Props) => {
  return (
    <>
      <div>
        <Heading size="4" className="px-6 py-2">
          {direction.charAt(0).toUpperCase() + direction.slice(1)}
        </Heading>
        <hr className="border-dashed border-gray-5" />
      </div>
      <ul className="flex flex-col flex-1 h-full overflow-y-auto scrollbar-thin">
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

          if (direction === 'across') {
            squareIsWithinClueBounds =
              currentCell >= boundsForClue[0] && currentCell <= boundsForClue[1]
          } else {
            const squaresWithinClueBounds = [boundsForClue[0]]

            const items =
              Math.ceil(
                (boundsForClue[1] - boundsForClue[0]) / crosswordData.size.cols,
              ) + 1

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
              bg = 'bg-amber-5'
            } else {
              bg = 'bg-amber-3'
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
                className={`py-1 pl-4 ${currentDirection === direction && bg}`}
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
