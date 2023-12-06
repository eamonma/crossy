'use client'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Flex, Heading, Switch, Text } from '@radix-ui/themes'
import parse from 'html-react-parser'

import { type Database } from '@/lib/database.types'

import Gameboard, { type CrosswordData } from './gameboard'
import Timer from './timer'
import { findBounds } from './utils'

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
  const gameboardRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (gameboardRef.current) {
      gameboardRef.current.focus()
    }
  }, [gameboardRef])

  const [clueNum, setClueNum] = useState(1)

  const acrossBounds = findBounds(
    crosswordData.grid,
    crosswordData.size.cols,
    crosswordData.size.rows,
    'across',
    currentCell,
    crosswordData.id,
  )

  const downBounds = findBounds(
    crosswordData.grid,
    crosswordData.size.cols,
    crosswordData.size.rows,
    'down',
    currentCell,
    crosswordData.id,
  )

  const clueNumAcross = crosswordData.gridnums[acrossBounds[0]] || clueNum
  const clueNumDown = crosswordData.gridnums[downBounds[0]] || clueNum

  const [isSmoothScrolling, setIsSmoothScrolling] = useState(true)

  acrossRef.current[clueNumAcross]?.scrollIntoView({
    // block: 'center',
    block: 'start',
    behavior: isSmoothScrolling ? 'smooth' : 'instant',
  })

  downRef.current[clueNumDown]?.scrollIntoView({
    block: 'start',
    // block: 'center',
    behavior: isSmoothScrolling ? 'smooth' : 'instant',
  })

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
    <div className="flex flex-col w-full h-full">
      <div className="relative flex flex-col items-center justify-between w-full h-20 py-2 font-medium text-center border-b border-dashed border-gray-5 text-4">
        <Flex
          gap="4"
          align="center"
          className="w-full px-5 pb-2 border-gray-5"
          justify="between"
        >
          <time className="text-gray-11">
            <Timer since={new Date(game.created_at).getTime()} />
          </time>
          <label>
            <Flex gap="2" align="center">
              <Switch
                onCheckedChange={(value) => {
                  setIsSmoothScrolling(value)
                }}
                checked={isSmoothScrolling}
              />
              <Text size="2">Smooth scrolling</Text>
            </Flex>
          </label>
        </Flex>
        <Flex className="w-full px-5">
          <Text>{parse(clueNumToClue(clueNum, currentDirection) ?? '')}</Text>
        </Flex>
      </div>
      <div className="h-[calc(100%-5rem)] grid grid-cols-1 sm:grid-cols-[4fr,3fr] items-center justify-center gap-4">
        <div className="flex flex-col justify-between h-full">
          <div className="relative flex flex-col justify-center flex-1 h-full">
            <div className="flex justify-start w-full">
              <div className="w-full pl-8 pr-3 max-h-[80vh] md:max-h-[75vh] lg:max-h-[70vh]">
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
        <div className="flex-col justify-center hidden h-full overflow-hidden collapse sm:visible sm:flex">
          <div className="relative grid justify-between flex-1 w-full h-full grid-cols-1 grid-rows-2 gap-0 text-lg border-l border-dashed border-gray-5">
            <div className="relative flex flex-col w-full border-b border-dashed border-gray-5">
              <div>
                <Heading className="px-6 py-2">Across</Heading>
                <hr className="border-dashed border-gray-5" />
              </div>
              <ul className="flex flex-col flex-1 h-[calc(100%-2rem)] overflow-y-auto">
                {crosswordData.clues.across.map((clue) => {
                  const clueNum = parseInt(
                    clue.substring(0, clue.indexOf('. ')),
                  )

                  const boundsForClue = findBounds(
                    crosswordData.grid,
                    crosswordData.size.cols,
                    crosswordData.size.rows,
                    'across',
                    crosswordData.gridnums.indexOf(clueNum),
                    crosswordData.id,
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
            {/* <hr className="absolute inset-y-0 w-full m-auto border-dashed" /> */}
            <div className="relative flex flex-col w-full">
              <div>
                <Heading className="px-6 py-2">Down</Heading>
                <hr className="border-dashed border-gray-5" />
              </div>
              <ul className="flex flex-col flex-1 h-[calc(100%-2rem)] overflow-y-auto">
                {crosswordData.clues.down.map((clue) => {
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
                    crosswordData.id,
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
    </div>
  )
}

export default GameLayout
