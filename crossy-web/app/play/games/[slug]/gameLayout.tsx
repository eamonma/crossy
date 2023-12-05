'use client'
import React, { useEffect, useRef, useState } from 'react'
import { Box, Card, Heading, Separator, Text } from '@radix-ui/themes'

import { type Database } from '@/lib/database.types'
import { createClient } from '@/utils/supabase/client'

import Gameboard, { type CrosswordData, findBounds } from './gameboard'

type Props = {
  game: Database['public']['Tables']['games']['Row']
  crosswordData: CrosswordData
}

const GameLayout: React.FC<Props> = ({ game, crosswordData }) => {
  const supabase = createClient<Database>()

  const [currentCell, setCurrentCell] = useState<number>(0)
  const [currentDirection, setCurrentDirection] = useState<'across' | 'down'>(
    'across',
  )

  const acrossRef = useRef<HTMLLIElement[]>([])
  const downRef = useRef<HTMLLIElement[]>([])

  const [clueNum, setClueNum] = useState(1)

  useEffect(() => {
    if (acrossRef.current[clueNum]) {
      acrossRef.current[clueNum].scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      })
    }
    if (downRef.current[clueNum]) {
      downRef.current[clueNum].scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      })
    }
  }, [clueNum])

  const ref = useRef<SVGElement>(null)

  //   console.log(changes)

  useEffect(() => {
    if (ref.current) {
      ref.current.focus()
    }
  }, [ref])

  return (
    <>
      <div className="px-5 h-full grid grid-cols-[4fr,3fr] items-center justify-center gap-4">
        <div className="relative flex flex-col justify-center h-full">
          {/* <div className="flex items-center justify-between px-6 mb-8">
            <div className="flex items-center gap-4">
              <div className="text-2xl font-bold">Puzzle Title</div>
              <Separator orientation="vertical" />
              <div className="text-lg">Puzzle Author</div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-lg">Timer</div>
              <Separator orientation="vertical" />
              <div className="text-lg">Check</div>
              <Separator orientation="vertical" />
              <div className="text-lg">Reveal</div>
            </div>
          </div> */}
          <div className="flex justify-start w-full">
            <div className="w-full max-h-[80vh]">
              <Gameboard
                game={game}
                crossword={crosswordData}
                currentCell={currentCell}
                setCurrentCell={setCurrentCell}
                currentDirection={currentDirection}
                setCurrentDirection={setCurrentDirection}
                setCurrentClueNum={setClueNum}
                boardRef={ref}
              />
            </div>
          </div>
        </div>
        {/* <div className="flex flex-1 h-full border">Clues</div> */}
        <div className="flex flex-col justify-center h-full overflow-hidden">
          <div className="flex-1 gap-8 justify-between grid-cols-1 w-full h-[calc(100%-2rem)] grid grid-rows-2 text-lg">
            <div className="relative flex flex-col w-full pt-4 border border-gray-5 rounded-3">
              <div>
                <Heading className="px-6">Across</Heading>
                <hr className="border-gray-4" />
              </div>
              <ul className="flex flex-col flex-1 h-[calc(100%-2rem)] overflow-y-auto">
                {crosswordData.clues.across.map((clue, i) => {
                  const clueNum = parseInt(
                    clue.substring(0, clue.indexOf('. ')),
                  )

                  const boundsForClue = findBounds(
                    crosswordData.grid,
                    crosswordData.size.cols,
                    crosswordData.size.rows,
                    'across',
                    crosswordData.gridnums.indexOf(clueNum),
                  )

                  const squareIsWithinClueBounds =
                    currentCell >= boundsForClue[0] &&
                    currentCell <= boundsForClue[1]

                  return (
                    <li
                      key={clueNum}
                      className={`grid grid-cols-[4ch,1fr] cursor-pointer gap-4 bg-opacity-30 py-1 ${
                        squareIsWithinClueBounds && 'bg-amber-4'
                      }`}
                      onClick={() => {
                        setCurrentDirection('across')
                        setClueNum(clueNum)
                        setCurrentCell(crosswordData.gridnums.indexOf(clueNum))
                        ref.current?.focus()
                      }}
                      ref={(ref) => (acrossRef.current[clueNum] = ref)}
                    >
                      <div className="text-right">{clueNum}</div>
                      <Text
                        dangerouslySetInnerHTML={{
                          __html: `${clue.substring(clue.indexOf(' '))}`,
                        }}
                      ></Text>
                    </li>
                  )
                })}
              </ul>
            </div>

            <div className="relative flex flex-col w-full pt-4 border border-gray-5 rounded-3">
              <div>
                <Heading className="px-6">Down</Heading>
                <hr className="border-gray-4" />
              </div>
              <ul className="flex flex-col flex-1 h-[calc(100%-2rem)] overflow-y-auto">
                {crosswordData.clues.down.map((clue, i) => {
                  const clueNum = parseInt(
                    clue.substring(0, clue.indexOf('. ')),
                  )

                  const boundsForClue = findBounds(
                    //   puzzle,
                    crosswordData.grid,
                    crosswordData.size.cols,
                    crosswordData.size.rows,
                    'down',
                    crosswordData.gridnums.indexOf(clueNum),
                  )

                  const squaresWithinClueBounds = [boundsForClue[0]]

                  const items =
                    Math.ceil(
                      (boundsForClue[1] - boundsForClue[0]) /
                        crosswordData.size.cols,
                    ) + 1

                  for (let j = 1; j < items; j++) {
                    squaresWithinClueBounds.push(
                      boundsForClue[0] + j * crosswordData.size.cols,
                    )
                  }

                  const squareIsWithinClueBounds =
                    squaresWithinClueBounds.includes(currentCell)

                  return (
                    <li
                      key={clueNum}
                      className={`grid grid-cols-[4ch,1fr] cursor-pointer gap-4 bg-opacity-30 py-1 ${
                        // crosswordData.gridnums[currentCell] === clueNum
                        squareIsWithinClueBounds && 'bg-amber-4'
                      }`}
                      onClick={() => {
                        setCurrentDirection('down')
                        setClueNum(clueNum)
                        setCurrentCell(crosswordData.gridnums.indexOf(clueNum))
                        ref.current?.focus()
                      }}
                      ref={(ref) => (downRef.current[clueNum] = ref)}
                    >
                      <div className="text-right">
                        {clue.substring(0, clue.indexOf('. '))}
                      </div>
                      <Text
                        dangerouslySetInnerHTML={{
                          __html: `${clue.substring(clue.indexOf(' '))}`,
                        }}
                      ></Text>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>

          {/* )} */}
        </div>
      </div>
      {/* <div>GameLayout</div> */}
    </>
  )
}

export default GameLayout
