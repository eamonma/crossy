import { Button, Heading } from '@radix-ui/themes'

import PuzzleContent from './puzzleContent'

const Loading = () => {
  return (
    <div className="h-full px-6">
      <div className="flex flex-col h-full gap-4 py-5">
        <Heading className="font-serif">Loading...</Heading>
        <div className="flex items-center justify-center flex-1 w-full h-full">
          <PuzzleContent
            crosswordData={{
              grid: [],
              gridnums: [],
              size: {
                cols: 15,
                rows: 15,
              },
            }}
          />
        </div>
        <form className="flex justify-end w-full">
          <Button disabled>Start a game</Button>
        </form>
      </div>
    </div>
  )
}

export default Loading
