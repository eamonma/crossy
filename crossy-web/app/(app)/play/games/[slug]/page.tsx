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

export const generateMetadata = async ({
  params,
  searchParams,
}: {
  params: { slug: string }
  searchParams?: Record<string, string | string[] | undefined>
}) => {
  const { slug } = params
  const cookieStore = cookies()
  const supabase = createClient<Database>(cookieStore)

  const { data: game, error: gameError } = await supabase
    .from('games')
    .select('*, puzzles(*)')
    .eq('id', slug)
    .single()

  if (!game && searchParams?.key) {
    return {
      title: 'Invite',
    }
  }

  if (gameError) {
    return {
      title: '404',
    }
  }

  let url = process.env.NEXT_PUBLIC_LIVE_DOMAIN ?? 'http://localhost:3000/'
  url = url.charAt(url.length - 1) === '/' ? url : `${url}/`

  if (game?.puzzles) {
    return {
      title: game?.puzzles?.name,
      openGraph: {
        images: `${url}api/og?game=${game.id}`,
        title: `${game?.puzzles?.name} — Crossy`,
        description: 'Solve crosswords together!',
        url: 'https://crossy.me',
        siteName: 'Crossy',
      },
      twitter: {
        card: 'summary_large_image',
        title: `${game?.puzzles?.name} — Crossy`,
        description: 'Solve crosswords together!',
        creator: '@eamonma',
        images: [`${url}api/og?game=${game.id}`],
      },
    }
  }
}

const Error = () => {
  return <div className="p-6">Could not retrieve game.</div>
}

const Finished = () => {
  return <div className="p-6">Cannot join a concluded game.</div>
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

  if (!user) return redirect('/login')

  const { data: game, error: gameError } = await supabase
    .from('games')
    .select('*, puzzles(*)')
    .eq('id', slug)
    .single()

  if (!game && searchParams?.key) {
    const pw = searchParams.key
    // invitee
    const dangerousSupabase = dangerouslyCreateServiceRoleClient<Database>()

    const { error: dangerousError, data: dangerousGame } =
      await dangerousSupabase
        .from('games')
        .select('*, status_of_game(status)')
        .eq('id', slug)
        .single()

    if (dangerousError) {
      console.error(dangerousError)
      return <Error />
    }

    if (dangerousGame.password !== pw) {
      return <Error />
    }

    const status = dangerousGame.status_of_game

    if (status?.status !== 'ongoing') {
      return <Finished />
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
