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

  // get puzzle
  // const puzzle = await supabase
  //   .from('puzzles')
  //   .select('*')
  //   .eq('id', slug)
  //   .single()

  const game = await supabase
    .from('games')
    .select('*, puzzles(*)')
    .eq('id', slug)
    .single()

  const { data, error } = game

  console.log(data, error)

  if (data?.puzzles) {
    const puzzle = data.puzzles
    const crosswordData: CrosswordData = {
      ...puzzle,
      size: {
        cols: puzzle.cols,
        rows: puzzle.rows,
      },
    }

    return <GameLayout game={data} crosswordData={crosswordData} />
  }
  return ''
}

export default Page
