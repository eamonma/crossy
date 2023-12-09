import { useEffect, useState } from 'react'
import {
  REALTIME_LISTEN_TYPES,
  REALTIME_PRESENCE_LISTEN_EVENTS,
  REALTIME_SUBSCRIBE_STATES,
  type RealtimeChannel,
  type RealtimeChannelSendResponse,
} from '@supabase/supabase-js'

import { type Database } from '@/lib/database.types'
import { type Payload } from '@/lib/types'
import { createClient } from '@/utils/supabase/client'

const useRealtimeCrossword = (
  roomId: string,
  userId: string,
  currentCell: number,
) => {
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([])
  const [friendsLocations, setFriendsLocations] = useState<
    Record<string, number>
  >({})
  const [isInitialStateSynced, setIsInitialStateSynced] =
    useState<boolean>(false)
  const supabase = createClient<Database>()

  const mapInitialUsers = (userChannel: RealtimeChannel) => {
    const state = userChannel.presenceState<{ user_id: string }>()
    const _users = state[roomId]

    if (!_users) return

    setOnlineUserIds(_users.map((user) => user.user_id))
  }

  useEffect(() => {
    const roomChannel = supabase.channel(`rooms-${roomId}`, {
      config: { presence: { key: roomId } },
    })

    roomChannel.on(
      REALTIME_LISTEN_TYPES.PRESENCE,
      {
        event: REALTIME_PRESENCE_LISTEN_EVENTS.JOIN,
      },
      () => {
        mapInitialUsers(roomChannel)
      },
    )

    roomChannel.on(
      REALTIME_LISTEN_TYPES.PRESENCE,
      { event: REALTIME_PRESENCE_LISTEN_EVENTS.SYNC },
      () => {
        setIsInitialStateSynced(true)
        mapInitialUsers(roomChannel)
      },
    )

    roomChannel.on(
      REALTIME_LISTEN_TYPES.PRESENCE,
      {
        event: REALTIME_PRESENCE_LISTEN_EVENTS.LEAVE,
      },
      (event) => {
        setFriendsLocations((prev) => {
          const nextLocations = { ...prev }
          for (const friend of event.leftPresences) {
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete nextLocations[friend.user_id]
          }
          return nextLocations
        })
      },
    )

    roomChannel.subscribe(async (status: `${REALTIME_SUBSCRIBE_STATES}`) => {
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        const resp: RealtimeChannelSendResponse = await roomChannel.track({
          user_id: userId,
        })

        if (resp !== 'ok') {
          console.error(resp)
        }
      }
    })

    return () => {
      void supabase.removeChannel(roomChannel).then()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, userId, supabase])

  useEffect(() => {
    if (!roomId || !isInitialStateSynced) return

    const messageChannel: RealtimeChannel = supabase.channel(
      `position-${roomId}`,
    )

    messageChannel.on(
      REALTIME_LISTEN_TYPES.BROADCAST,
      { event: 'POS' },
      (payload: Payload<{ user_id: string } & { currentCell: number }>) => {
        const { payload: res, event, type } = payload
        if (event !== 'POS' || type !== 'broadcast') return
        if (!res) return
        if (res.user_id === userId) return

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
          payload: { user_id: userId, currentCell },
        })
      }
    })

    return () => {
      void supabase.removeChannel(messageChannel).then()
    }
  }, [roomId, userId, currentCell, isInitialStateSynced, supabase])

  return { onlineUserIds, friendsLocations }
}

export default useRealtimeCrossword
