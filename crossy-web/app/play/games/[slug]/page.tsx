import React from 'react'
import { cookies } from 'next/headers'

import { type CrosswordData } from '@/components/crosswordGridDisplay'
import { type Database } from '@/lib/database.types'
import { createClient } from '@/utils/supabase/server'

import PuzzleContent from '../../puzzles/[slug]/puzzleContent'

const Page = async ({ params }: { params: { slug: string } }) => {
  const { slug } = params
  const cookieStore = cookies()
  const supabase = createClient<Database>(cookieStore)

  // get puzzle
  const puzzle = await supabase
    .from('puzzles')
    .select('*')
    .eq('id', slug)
    .single()

  const { data, error } = puzzle

  if (data) {
    const crosswordData: CrosswordData = {
      ...data,
      size: {
        cols: data.cols,
        rows: data.rows,
      },
    }

    return (
      <div>
        <PuzzleContent crosswordData={crosswordData} />
      </div>
    )
  }
  return ''
}

export default Page
