'use client'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Flex, Text } from '@radix-ui/themes'
import {
  REALTIME_LISTEN_TYPES,
  REALTIME_PRESENCE_LISTEN_EVENTS,
  REALTIME_SUBSCRIBE_STATES,
  type RealtimeChannel,
  type RealtimeChannelSendResponse,
  type User,
} from '@supabase/supabase-js'
import parse from 'html-react-parser'

import { type Database } from '@/lib/database.types'
import { type Payload } from '@/lib/types'
import { createClient } from '@/utils/supabase/client'

import Clues from './clues'
import Gameboard, { type CrosswordData } from './gameboard'
import OnlineUsers from './onlineUsers'
import ShareLink from './shareLink'
import Timer from './timer'
import { findBounds } from './utils'

type Props = {
  game: Database['public']['Tables']['games']['Row']
  crosswordData: CrosswordData
  user: User
}

const GameLayout: React.FC<Props> = ({ game, crosswordData, user }) => {
  const supabase = createClient<Database>()
  const [currentCell, setCurrentCell] = useState<number>(0)
  const [currentDirection, setCurrentDirection] = useState<'across' | 'down'>(
    'across',
  )
  const [isInitialStateSynced, setIsInitialStateSynced] =
    useState<boolean>(false)
  const [friendsLocations, setFriendsLocations] = useState<
    Record<string, number>
  >({})
  const acrossRef = useRef<Array<HTMLLIElement | null>>([])
  const downRef = useRef<Array<HTMLLIElement | null>>([])
  const gameboardRef = useRef<SVGSVGElement>(null)

  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([])

  const mapInitialUsers = (userChannel: RealtimeChannel, roomId: string) => {
    const state = userChannel.presenceState<{ user_id: string }>()
    const _users = state[roomId]

    if (!_users) return

    setOnlineUserIds(_users.map((user) => user.user_id))
  }

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

  acrossRef.current[clueNumAcross]?.scrollIntoView({
    // block: 'center',
    block: 'start',
    behavior: 'instant',
  })

  downRef.current[clueNumDown]?.scrollIntoView({
    // block: 'center',
    block: 'start',
    behavior: 'instant',
  })

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

  const roomId = game.id
  useEffect(() => {
    const roomChannel = supabase.channel('rooms', {
      config: { presence: { key: roomId } },
    })
    roomChannel.on(
      REALTIME_LISTEN_TYPES.PRESENCE,
      { event: REALTIME_PRESENCE_LISTEN_EVENTS.SYNC },
      () => {
        setIsInitialStateSynced(true)
        mapInitialUsers(roomChannel, roomId)
      },
    )
    roomChannel.subscribe(async (status: `${REALTIME_SUBSCRIBE_STATES}`) => {
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        const resp: RealtimeChannelSendResponse = await roomChannel.track({
          user_id: user.id,
        })

        if (resp === 'ok') {
          // noop
        } else {
          console.error(resp)
        }
      }
    })
  }, [roomId, supabase])

  useEffect(() => {
    if (!roomId || !isInitialStateSynced) return

    const userId = user.id

    const messageChannel: RealtimeChannel = supabase.channel(
      `position:${roomId}`,
    )

    // Listen for cursor positions from other users in the room
    messageChannel.on(
      REALTIME_LISTEN_TYPES.BROADCAST,
      { event: 'POS' },
      (payload: Payload<{ user_id: string } & { currentCell: number }>) => {
        const { payload: res, event, type } = payload
        if (event !== 'POS' || type !== 'broadcast') return
        if (!res) return
        if (res?.user_id === userId) return

        setFriendsLocations((prev) => ({
          ...prev,
          [res.user_id]: res.currentCell,
        }))
      },
    )

    messageChannel.subscribe(async (status: `${REALTIME_SUBSCRIBE_STATES}`) => {
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        await messageChannel.send({
          type: 'broadcast',
          event: 'POS',
          payload: { user_id: user.id, currentCell },
        })
      }
    })

    return () => {
      if (messageChannel) {
        void supabase.removeChannel(messageChannel).then()
      }
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, isInitialStateSynced, currentCell])

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
      <div className="relative flex flex-col items-center justify-between w-full h-20 py-2 font-medium text-center border-b border-dashed border-gray-5 text-4">
        <Flex
          gap="4"
          align="center"
          className="w-full px-4 pb-2 border-gray-5"
          justify="between"
        >
          <time className="text-gray-10">
            <Timer since={new Date(game.created_at).getTime()} />
          </time>
          <Flex gap="4" align="center">
            <OnlineUsers userIds={onlineUserIds} />
            <ShareLink game={game} />
          </Flex>
        </Flex>
        <Flex justify="between" className="w-full">
          <Flex className="w-full px-4" align="baseline">
            <Flex
              align="center"
              gap="1"
              className="text-left w-[5ch] text-gray-10"
            >
              <Text>{clueNum}</Text>
              {currentDirection === 'across' ? 'A' : 'D'}
            </Flex>
            <Text>{parse(clueNumToClue(clueNum, currentDirection) ?? '')}</Text>
          </Flex>
        </Flex>
      </div>
      <div className="h-[calc(100%-5rem)] grid grid-cols-1 sm:grid-cols-[4fr,3fr] items-center justify-center gap-4">
        <div className="flex flex-col justify-between h-full">
          <div className="relative flex flex-col justify-center flex-1 h-full">
            <div className="flex justify-start w-full">
              <div className="w-full pl-8 pr-3 max-h-[80vh] md:max-h-[75vh] lg:max-h-[70vh]">
                <Gameboard
                  friendsLocations={friendsLocations}
                  game={game}
                  {...commonProps}
                />
              </div>
            </div>
          </div>
        </div>
        <div className="flex-col justify-center hidden h-full overflow-hidden collapse sm:visible sm:flex rounded-4">
          <div className="relative grid justify-between flex-1 w-full h-full grid-cols-1 grid-rows-2 gap-0 text-lg border-l border-dashed border-gray-5">
            <div className="relative flex flex-col w-full border-b border-dashed border-gray-5">
              <Clues
                {...commonProps}
                listRef={acrossRef}
                direction={'across'}
              />
            </div>

            <div className="relative flex flex-col w-full">
              <Clues {...commonProps} listRef={downRef} direction={'down'} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default GameLayout
