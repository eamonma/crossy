import React from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { type Database } from '@/lib/database.types'
import {
  createClient,
  dangerouslyCreateServiceRoleClient,
} from '@/utils/supabase/server'

import { type CrosswordData } from './gameboard'
import GameLayout from './gameLayout'

const Error = () => {
  return <div className="p-6">Could not retrieve game</div>
}

const Page = async ({
  params,
  searchParams,
}: {
  params: { slug: string }
  searchParams?: Record<string, string | string[] | undefined>
}) => {
  const { slug } = params
  const cookieStore = cookies()
  const supabase = createClient<Database>(cookieStore)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return <Error />
  }

  const { data: game, error: gameError } = await supabase
    .from('games')
    .select('*, puzzles(*)')
    .eq('id', slug)
    .single()

  if (!game && searchParams?.password) {
    const pw = searchParams.password
    // invitee
    const dangerousSupabase = dangerouslyCreateServiceRoleClient<Database>()

    const { error: dangerousError, data: dangerousGame } =
      await dangerousSupabase.from('games').select('*').eq('id', slug).single()

    if (dangerousError) {
      console.error(dangerousError)
      return <Error />
    }

    if (dangerousGame.password !== pw) {
      return <Error />
    }

    await dangerousSupabase
      .from('game_user')
      .insert({
        game_id: dangerousGame.id,
        user_id: user.id,
      })
      .single()

    return redirect(`/play/games/${slug}`)
  }

  if (gameError) {
    console.error(gameError)
    return <Error />
  }

  if (game?.puzzles) {
    const puzzle = game.puzzles
    const crosswordData: CrosswordData = {
      ...puzzle,
      size: {
        cols: puzzle.cols,
        rows: puzzle.rows,
      },
    } as unknown as CrosswordData

    return <GameLayout user={user} game={game} crosswordData={crosswordData} />
  }
  return ''
}

export default Page
// dont cache
export const revalidate = 0
export const dynamic = 'force-dynamic'
