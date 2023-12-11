import React from 'react'
import { Flex } from '@radix-ui/themes'

import PuzzleContent from '../../puzzles/[slug]/puzzleContent'

const Loading = () => {
  return (
    <div className="flex flex-col w-full h-full">
      <div className="relative flex flex-col items-center justify-between w-full h-20 py-2 font-medium text-center border-b border-dashed ">
        <Flex
          gap="4"
          align="center"
          className="w-full px-4 pb-2 "
          justify="between"
        >
          <time className="text-gray-10">00:00:00</time>
          <Flex gap="4" align="center"></Flex>
        </Flex>
        <Flex className="w-full px-4" align="baseline">
          <Flex align="center" gap="1" className="text-left w-[5ch]"></Flex>
        </Flex>
      </div>
      <div className="h-[calc(100%-5rem)] grid grid-cols-1 sm:grid-cols-[4fr,3fr] items-center justify-center gap-4">
        <div className="flex flex-col justify-between h-full">
          <div className="relative flex flex-col justify-center flex-1 h-full">
            <div className="flex justify-start w-full">
              <div className="w-full pl-8 pr-3 max-h-[80svh] md:max-h-[75svh] lg:max-h-[70svh]">
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
            </div>
          </div>
        </div>
        <div className="flex-col justify-center hidden h-full overflow-hidden collapse sm:visible sm:flex rounded-4">
          <div className="relative grid justify-between flex-1 w-full h-full grid-cols-1 grid-rows-2 gap-0 text-lg border-l border-dashed border-gray-5"></div>
        </div>
      </div>
    </div>
  )
}

export default Loading
