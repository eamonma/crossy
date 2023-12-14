import { useEffect, useState } from 'react'
import {
  REALTIME_LISTEN_TYPES,
  REALTIME_PRESENCE_LISTEN_EVENTS,
  REALTIME_SUBSCRIBE_STATES,
  type RealtimeChannel,
  type RealtimeChannelSendResponse,
  type RealtimePostgresChangesPayload,
  type RealtimePostgresUpdatePayload,
} from '@supabase/supabase-js'

import { type Database } from '@/lib/database.types'
import { type Payload } from '@/lib/types'
import { createClient } from '@/utils/supabase/client'

import { debounce } from './debounce'

const useRealtimeCrossword = (
  gameId: string,
  userId: string,
  currentCell: number,
  initialRemoteAnswers: string[] = [],
) => {
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([])
  const [friendsLocations, setFriendsLocations] = useState<
    Record<string, number>
  >({})
  const [statusOfGame, setStatus] =
    useState<Database['public']['Tables']['status_of_game']['Row']>()
  const [isInitialStateSynced, setIsInitialStateSynced] =
    useState<boolean>(false)
  const [remoteAnswers, setAnswers] = useState<string[]>(initialRemoteAnswers)
  const supabase = createClient<Database>()

  const mapInitialUsers = (userChannel: RealtimeChannel) => {
    const state = userChannel.presenceState<{ user_id: string }>()
    const _users = state[gameId]

    if (!_users) return

    setOnlineUserIds(_users.map((user) => user.user_id))
  }

  useEffect(() => {
    // initial fetch
    const fetch = async () => {
      const { data, error } = await supabase
        .from('status_of_game')
        .select('*')
        .eq('id', gameId)
        .single()

      if (error) {
        console.error(error)
        return
      }

      return data
    }

    void fetch().then((data) => {
      if (!data) return
      setStatus(data)
    })

    const handleNewStatus = (
      payload: RealtimePostgresChangesPayload<Record<string, any>>,
    ) => {
      if (!payload) return
      const { new: newState } = payload as RealtimePostgresUpdatePayload<
        Record<string, any>
      >
      if (newState.id !== gameId) return
      setStatus(
        newState as Database['public']['Tables']['status_of_game']['Row'],
      )
    }

    const handleChange = debounce(
      (payload: RealtimePostgresChangesPayload<Record<string, any>>) => {
        if (!payload) return
        const { new: newState } = payload as RealtimePostgresUpdatePayload<
          Record<string, any>
        >
        setAnswers(newState.grid)
      },
      200,
    )

    const changes = supabase
      .channel('table-db-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'status_of_game',
          filter: 'id=eq.' + gameId,
        },
        handleNewStatus,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'games',
          filter: 'id=eq.' + gameId,
        },
        handleChange,
      )
      .subscribe()

    return () => {
      void changes.unsubscribe().then(() => {})
    }
  }, [gameId, supabase])

  useEffect(() => {
    const roomChannel = supabase.channel(`rooms-${gameId}`, {
      config: { presence: { key: gameId } },
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
  }, [gameId, userId, supabase])

  useEffect(() => {
    if (!gameId || !isInitialStateSynced) return

    const messageChannel: RealtimeChannel = supabase.channel(
      `position-${gameId}`,
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
  }, [gameId, userId, currentCell, isInitialStateSynced, supabase])

  const updateGridItem = (
    index: number,
    value: string | null,
    cb?: () => void,
  ) => {
    const newValue = value ?? (null as unknown as string)

    void supabase
      .rpc('update_grid_element', {
        game_id: gameId,
        grid_index: index,
        new_value: newValue,
      })
      .then(cb)
  }

  return {
    onlineUserIds,
    friendsLocations,
    statusOfGame,
    remoteAnswers,
    updateGridItem,
  }
}

export default useRealtimeCrossword
