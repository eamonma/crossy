'use client'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Switch, Text } from '@radix-ui/themes'
import { type User } from '@supabase/supabase-js'
import parse from 'html-react-parser'

import { type Database } from '@/lib/database.types'

import Clues from './clues'
import Confetti from './confetti'
import Congrats from './congrats'
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
  const [isExploding, setIsExploding] = useState(false)
  const [claimedToBeComplete, setClaimedToBeComplete] = useState(false)
  const [answers, setAnswers] = useState<string[]>(game.grid)

  const { onlineUserIds, friendsLocations, statusOfGame, remoteAnswers } =
    useRealtimeCrossword(game.id, user.id, currentCell, game.grid)

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
    answers,
    setAnswers,
  }

  const gameStatus = statusOfGame?.status

  useEffect(() => {
    if (gameStatus === 'completed') {
      setClaimedToBeComplete(true)
      setIsExploding(true)
    }

    const timeout = setTimeout(() => {
      setIsExploding(false)
    }, 5000)

    return () => {
      clearTimeout(timeout)
    }
  }, [gameStatus])

  const claimComplete = () => {
    setClaimedToBeComplete(true)

    fetch('/api/games/claim-complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(game.id),
    })
      .then(async (response) => await response.json())
      .then(({ error }) => {
        if (error) {
          console.error(error)
          setClaimedToBeComplete(false)
        }
      })
      .catch((error) => {
        setClaimedToBeComplete(false)
        console.error('Error:', error)
      })
  }

  return (
    <div className="flex flex-col w-full h-full min-w-fit">
      <Congrats isOpen={claimedToBeComplete} status={gameStatus} />
      <Confetti run={gameStatus === 'completed'} recycle={isExploding} />
      <div className="relative flex flex-col items-center justify-between w-full h-20 text-lg font-medium text-center">
        <Toolbar
          top={
            <>
              <div className="flex items-center gap-2">
                <time className="text-left text-gray-900 min-w-[7ch]">
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
              <div className="flex items-center gap-4">
                {gameStatus === 'ongoing' && (
                  <OnlineUsers userIds={onlineUserIds} />
                )}
                <label className="items-center hidden gap-2 md:flex">
                  <Switch
                    checked={shouldScrollSmoothly}
                    onCheckedChange={() => {
                      setShouldScrollSmoothly((prev) => !prev)
                      gameboardRef.current?.focus()
                    }}
                  />
                  <Text size="2">Smooth scroll</Text>
                </label>
                <ShareLink game={game} />
              </div>
            </>
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
            <div className="w-full pl-8 pr-3 max-h-[68svh] md:max-h-[75svh] lg:max-h-[70svh]">
              <Gameboard
                {...commonProps}
                remoteAnswers={remoteAnswers}
                friendsLocations={friendsLocations}
                gameIsOngoing={gameStatus === 'ongoing'}
                claimComplete={claimComplete}
                game={game}
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
    </div>
  )
}

export default GameLayout
