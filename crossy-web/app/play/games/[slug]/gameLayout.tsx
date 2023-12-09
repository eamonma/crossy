'use client'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Switch, Text } from '@radix-ui/themes'
import { type User } from '@supabase/supabase-js'
import parse from 'html-react-parser'

import { type Database } from '@/lib/database.types'

import Clues from './clues'
import Gameboard, { type CrosswordData } from './gameboard'
import EmbeddedKeyboard from './keyboard'
import OnlineUsers from './onlineUsers'
import ShareLink from './shareLink'
import Timer from './timer'
import Toolbar from './toolbar'
import useRealtimeCrossword from './useRealtimeCrossword'
import { getNextCell } from './utils'

type Props = {
  game: Database['public']['Tables']['games']['Row']
  crosswordData: CrosswordData
  user: User
}

const GameLayout: React.FC<Props> = ({ game, crosswordData, user }) => {
  const [currentCell, setCurrentCell] = useState<number>(
    getNextCell(
      crosswordData.grid,
      crosswordData.size.cols,
      crosswordData.size.rows,
      'across',
      -1,
      'more',
    ),
  )
  const [currentDirection, setCurrentDirection] = useState<'across' | 'down'>(
    'across',
  )
  const gameboardRef = useRef<SVGSVGElement>(null)
  const [shouldScrollSmoothly, setShouldScrollSmoothly] =
    useState<boolean>(false)

  const [clueNum, setClueNum] = useState(1)

  const { onlineUserIds, friendsLocations } = useRealtimeCrossword(
    game.id,
    user.id,
    currentCell,
  )

  const clueNumToClueAcross = useMemo(() => {
    const clueNumToClueAcross = new Map<number, string>()

    crosswordData.clues.across.forEach((clue) => {
      const clueNum = parseInt(clue.substring(0, clue.indexOf('. ')))
      clueNumToClueAcross.set(clueNum, clue.substring(clue.indexOf(' ')))
    })

    return clueNumToClueAcross
  }, [crosswordData.clues.across])

  const clueNumToClueDown = useMemo(() => {
    const clueNumToClueDown = new Map<number, string>()

    crosswordData.clues.down.forEach((clue) => {
      const clueNum = parseInt(clue.substring(0, clue.indexOf('. ')))
      clueNumToClueDown.set(clueNum, clue.substring(clue.indexOf(' ')))
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

  useEffect(() => {
    if (gameboardRef.current) {
      gameboardRef.current.focus()
    }
  }, [gameboardRef])

  const commonProps = {
    crosswordData,
    currentCell,
    setCurrentCell,
    currentDirection,
    setCurrentDirection,
    setClueNum,
    gameboardRef,
  }

  return (
    <div className="flex flex-col w-full h-full">
      <div className="relative flex flex-col items-center justify-between w-full h-20 font-medium text-center text-4">
        <Toolbar
          top={
            <>
              <time className="text-gray-10">
                <Timer since={new Date(game.created_at).getTime()} />
              </time>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2">
                  <Switch
                    checked={shouldScrollSmoothly}
                    onCheckedChange={() => {
                      setShouldScrollSmoothly((prev) => !prev)
                      gameboardRef.current?.focus()
                    }}
                  />
                  <Text size="2">Smooth scroll</Text>
                </label>
                <OnlineUsers userIds={onlineUserIds} />
                <ShareLink game={game} />
              </div>
            </>
          }
          clue={
            <div className="flex items-baseline w-full">
              <div className="flex items-center text-left w-[5ch] text-gray-10">
                <Text>{clueNum}</Text>
                {currentDirection === 'across' ? 'A' : 'D'}
              </div>
              <Text className="relative flex-1 pr-4 text-left">
                {parse(clueNumToClue(clueNum, currentDirection) ?? '')}
              </Text>
            </div>
          }
        />
      </div>
      <div className="max-h-[calc(100%-5rem)] flex-1 grid grid-cols-1 sm:grid-cols-[4fr,3fr] items-center justify-center gap-4">
        <div className="relative flex flex-col justify-center flex-1 h-full">
          <div className="flex flex-col justify-start w-full">
            <div className="w-full pl-8 pr-3 max-h-[70vh] md:max-h-[75vh] lg:max-h-[70vh]">
              <Gameboard
                {...commonProps}
                friendsLocations={friendsLocations}
                game={game}
              />
            </div>
          </div>
          <div className="visible px-1 mt-4 sm:hidden">
            <EmbeddedKeyboard gameboardRef={gameboardRef} />
          </div>
        </div>

        <div className="flex-col justify-center hidden h-full overflow-hidden collapse sm:visible sm:flex rounded-4">
          <div className="relative grid justify-between flex-1 w-full h-full grid-cols-1 grid-rows-2 gap-0 text-lg border-l border-dashed border-gray-5">
            <div className="relative flex flex-col w-full border-b border-dashed border-gray-5">
              <Clues
                {...commonProps}
                shouldScrollSmoothly={shouldScrollSmoothly}
                direction={'across'}
              />
            </div>

            <div className="relative flex flex-col w-full">
              <Clues
                {...commonProps}
                shouldScrollSmoothly={shouldScrollSmoothly}
                direction={'down'}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default GameLayout
