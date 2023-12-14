'use client'
import React, { useRef, useState } from 'react'
import { Badge, Text } from '@radix-ui/themes'
import { type User } from '@supabase/supabase-js'
import parse from 'html-react-parser'

import { type Database } from '@/lib/database.types'
import useAutofocus from '@/lib/useAutofocus'

import Check from './check'
import Clues from './clues'
import Confetti from './confetti'
import Congrats from './congrats'
import Gameboard, { type CrosswordData } from './gameboard'
import EmbeddedKeyboard from './keyboard'
import OfflineNotice from './offlineNotice'
import OnlineUsers from './onlineUsers'
import ShareLink from './shareLink'
import Timer from './timer'
import Toolbar from './toolbar'
import useClueNumToClue from './useClueNumToClue'
import useConclusion from './useConclusion'
import useRealtimeCrossword from './useRealtimeCrossword'
import useSwipablePreventScroll from './useSwipablePreventScroll'
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
  const [shouldScrollSmoothly] = useState<boolean>(false)
  const [clueNum, setClueNum] = useState(1)
  const [answers, setAnswers] = useState<string[]>(game.grid)
  const [highlights, setHighlights] = useState<Record<number, string>>({})

  const {
    onlineUserIds,
    friendsLocations,
    statusOfGame,
    remoteAnswers,
    updateGridItem,
  } = useRealtimeCrossword(game.id, user.id, currentCell, game.grid)

  const clueNumToClue = useClueNumToClue(crosswordData)

  const gameStatus = statusOfGame?.status
  const { claimComplete, claimedToBeComplete, isExploding } = useConclusion(
    game.id,
    gameStatus,
  )

  useSwipablePreventScroll()
  useAutofocus(gameboardRef)

  const commonProps = {
    crosswordData,
    currentCell,
    setCurrentCell,
    currentDirection,
    setCurrentDirection,
    setClueNum,
    gameboardRef,
    answers,
    setAnswers,
    highlights,
    setHighlights,
  }

  return (
    <div className="flex flex-col w-full h-full min-w-fit">
      <div className="relative flex flex-col items-center justify-between w-full h-20 text-lg font-medium text-center">
        <Toolbar
          alwaysVisibleTools={<OnlineUsers userIds={onlineUserIds} />}
          tools={
            <div className="flex items-center gap-2">
              <Check {...commonProps} />
              <ShareLink game={game} />
            </div>
          }
          timer={
            <div className="flex items-center gap-2">
              <time className="text-left text-gray-900 min-w-[7ch] whitespace-nowrap">
                <Timer
                  since={new Date(game.created_at).getTime()}
                  statusOfGame={statusOfGame}
                />
              </time>
              {gameStatus === 'completed' && (
                <Badge radius="full" color="green" size="1">
                  Done | Read-only
                </Badge>
              )}
            </div>
          }
          clue={
            <div className="flex items-baseline w-full">
              <div className="flex items-center text-left text-gray-900 w-[5ch]">
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
      <div className="max-h-[calc(100%-5rem)] flex-1 grid grid-cols-1 md:grid-cols-[4fr,3fr] items-center justify-center gap-4">
        <div className="relative flex flex-col justify-end flex-1 h-full sm:justify-center">
          <div className="flex flex-col justify-start w-full">
            <div className="w-full px-1 sm:px-3 sm:pl-8 max-h-[68svh] md:max-h-[75svh] lg:max-h-[70svh]">
              <Gameboard
                {...commonProps}
                updateGridItem={updateGridItem}
                remoteAnswers={remoteAnswers}
                friendsLocations={friendsLocations}
                gameIsOngoing={gameStatus === 'ongoing'}
                claimComplete={claimComplete}
              />
            </div>
          </div>
          <div className="items-end visible w-full mt-4 overflow-hidden rounded-md sm:hidden">
            <EmbeddedKeyboard gameboardRef={gameboardRef} />
          </div>
        </div>

        <div className="flex-col justify-center hidden h-full overflow-hidden collapse sm:visible md:flex rounded-4">
          <div className="relative grid justify-between flex-1 w-full h-full grid-cols-1 grid-rows-2 gap-0 text-lg border-l border-dashed">
            <div className="relative flex flex-col w-full border-b border-dashed">
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
      <OfflineNotice />
      <Congrats isOpen={claimedToBeComplete} status={gameStatus} />
      <Confetti run={gameStatus === 'completed'} recycle={isExploding} />
    </div>
  )
}

export default GameLayout
