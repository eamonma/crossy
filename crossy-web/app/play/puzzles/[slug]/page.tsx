import { Button, Heading } from '@radix-ui/themes'
import { cookies } from 'next/headers'
import Image from 'next/image'
import Link from 'next/link'

import { type CrosswordData } from '@/components/crosswordGridDisplay'
import { type Database } from '@/lib/database.types'
import { createClient } from '@/utils/supabase/server'

import PuzzleContent from './puzzleContent'

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

  let content

  if (error) {
    content = (
      <div className="h-full relative">
        {/* <Heading>404!</Heading> */}
        <div className="flex justify-center items-center absolute inset-0">
          <div className="w-full flex max-w-sm flex-col gap-4 items-center">
            <Image
              src="/404.png"
              alt="404 notice"
              className="object-fit rounded-6 shadow-4"
              height="1024"
              width="1024"
            />
            <Heading size="4">Couldn't find this puzzle!</Heading>
          </div>
        </div>
      </div>
    )
  } else {
    const crosswordData: CrosswordData = {
      ...data,
      size: {
        cols: data.cols,
        rows: data.rows,
      },
    }

    content = (
      <div className="flex flex-col h-full gap-4">
        <Heading className="font-serif">{data.name}</Heading>
        <div className="flex w-full justify-center items-center h-full flex-1">
          <PuzzleContent crosswordData={crosswordData} />
        </div>
        <div className="flex w-full justify-end ">
          <Button asChild>
            <Link href={`/play/games/${data.id}`}>Start a game</Link>
          </Button>
        </div>
      </div>
    )
  }

  return <div className="px-6 h-full">{content}</div>
}

export default Page
