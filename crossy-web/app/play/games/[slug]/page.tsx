import React from 'react'
import { cookies } from 'next/headers'

import { type Database } from '@/lib/database.types'
import { createClient } from '@/utils/supabase/server'

import { type CrosswordData } from './gameboard'
import GameLayout from './gameLayout'

const Page = async ({ params }: { params: { slug: string } }) => {
  const { slug } = params
  const cookieStore = cookies()
  const supabase = createClient<Database>(cookieStore)

  const game = await supabase
    .from('games')
    .select('*, puzzles(*)')
    .eq('id', slug)
    .single()

  const { data, error } = game

  if (error) {
    console.error(error)
    return ''
  }

  if (data?.puzzles) {
    const puzzle = data.puzzles
    const crosswordData: CrosswordData = {
      ...puzzle,
      size: {
        cols: puzzle.cols,
        rows: puzzle.rows,
      },
    } as unknown as CrosswordData

    return <GameLayout game={data} crosswordData={crosswordData} />
  }
  return ''
}

export default Page
