'use client'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Heading, Text } from '@radix-ui/themes'
import parse from 'html-react-parser'

import { type Database } from '@/lib/database.types'

import Gameboard, { type CrosswordData, findBounds } from './gameboard'

type Props = {
  game: Database['public']['Tables']['games']['Row']
  crosswordData: CrosswordData
}

const GameLayout: React.FC<Props> = ({ game, crosswordData }) => {
  const [currentCell, setCurrentCell] = useState<number>(0)
  const [currentDirection, setCurrentDirection] = useState<'across' | 'down'>(
    'across',
  )

  const acrossRef = useRef<Array<HTMLLIElement | null>>([])
  const downRef = useRef<Array<HTMLLIElement | null>>([])
  const gameboardRef = useRef<SVGElement>(null)

  useEffect(() => {
    if (gameboardRef.current) {
      gameboardRef.current.focus()
    }
  }, [gameboardRef])

  const [clueNum, setClueNum] = useState(1)

  useEffect(() => {
    acrossRef.current[clueNum]?.scrollIntoView({
      block: 'center',
      behavior: 'smooth',
    })

    downRef.current[clueNum]?.scrollIntoView({
      block: 'center',
      behavior: 'smooth',
    })
  }, [clueNum])

  const clueNumToClueAcross = useMemo(() => {
    const clueNumToClueAcross = new Map<number, string>()

    crosswordData.clues.across.forEach((clue) => {
      const clueNum = parseInt(clue.substring(0, clue.indexOf('. ')))
      clueNumToClueAcross.set(clueNum, clue)
    })

    return clueNumToClueAcross
  }, [crosswordData.clues.across])

  const clueNumToClueDown = useMemo(() => {
    const clueNumToClueDown = new Map<number, string>()

    crosswordData.clues.down.forEach((clue) => {
      const clueNum = parseInt(clue.substring(0, clue.indexOf('. ')))
      clueNumToClueDown.set(clueNum, clue)
    })

    return clueNumToClueDown
  }, [crosswordData.clues.down])

  const clueNumToClue = (clueNum: number, direction: 'across' | 'down') => {
    if (direction === 'across') {
      return clueNumToClueAcross.get(clueNum)
    } else {
      return clueNumToClueDown.get(clueNum)
    }
  }

  return (
    <>
      <div className="px-5 h-full grid grid-cols-[4fr,3fr] items-center justify-center gap-4">
        <div className="flex flex-col justify-between h-full">
          <div
            className="relative flex items-center justify-center w-full h-12 px-6 font-medium text-center text-5 border-gray-5 shadow-3"
            style={{
              borderRadius: '999px',
            }}
          >
            {parse(clueNumToClue(clueNum, currentDirection) ?? '&nbsp;')}
          </div>

          <div className="relative flex flex-col justify-center flex-1 h-full">
            <div className="flex justify-start w-full">
              <div className="w-full max-h-[80vh] lg:max-h-[70vh]">
                <Gameboard
                  game={game}
                  crossword={crosswordData}
                  currentCell={currentCell}
                  setCurrentCell={setCurrentCell}
                  currentDirection={currentDirection}
                  setCurrentDirection={setCurrentDirection}
                  setCurrentClueNum={setClueNum}
                  boardRef={gameboardRef}
                />
              </div>
            </div>
          </div>
        </div>
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
                        gameboardRef.current?.focus()
                      }}
                      ref={(ref) => (acrossRef.current[clueNum] = ref)}
                    >
                      <div className="text-right">{clueNum}</div>
                      <Text>
                        {parse(`${clue.substring(clue.indexOf(' '))}`)}
                      </Text>
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
                        gameboardRef.current?.focus()
                      }}
                      ref={(ref) => (downRef.current[clueNum] = ref)}
                    >
                      <div className="text-right">
                        {clue.substring(0, clue.indexOf('. '))}
                      </div>
                      <Text>
                        {parse(`${clue.substring(clue.indexOf(' '))}`)}
                      </Text>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default GameLayout
