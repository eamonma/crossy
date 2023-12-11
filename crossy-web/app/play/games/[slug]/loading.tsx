import React from 'react'
import { Text } from '@radix-ui/themes'

import Toolbar from './toolbar'

const Loading = () => {
  return (
    <div className="flex flex-col w-full h-full min-w-fit">
      <div className="relative flex flex-col items-center justify-between w-full h-20 text-lg font-medium text-center">
        <Toolbar
          top={
            <>
              <div className="flex items-center gap-2">
                <time className="text-left text-gray-900 min-w-[7ch]">
                  00:00:00
                </time>
              </div>
              <div className="flex items-center gap-4"></div>
            </>
          }
          clue={
            <div className="flex items-baseline w-full">
              <div className="flex items-center text-left text-gray-900 w-[5ch]">
                <Text>1</Text>A
              </div>
              <Text className="relative flex-1 pr-4 text-left">Loading...</Text>
            </div>
          }
        />
      </div>
      <div className="max-h-[calc(100%-5rem)] flex-1 grid grid-cols-1 md:grid-cols-[4fr,3fr] items-center justify-center gap-4">
        <div className="relative flex flex-col justify-end flex-1 h-full sm:justify-center">
          <div className="flex flex-col justify-start w-full">
            <div className="w-full pl-8 pr-3 max-h-[68svh] md:max-h-[75svh] lg:max-h-[70svh]"></div>
          </div>
          <div className="items-end visible w-full mt-4 overflow-hidden rounded-md sm:hidden"></div>
        </div>

        <div className="flex-col justify-center hidden h-full overflow-hidden collapse sm:visible md:flex rounded-4">
          <div className="relative grid justify-between flex-1 w-full h-full grid-cols-1 grid-rows-2 gap-0 text-lg border-l border-dashed">
            <div className="relative flex flex-col w-full border-b border-dashed" />

            <div className="relative flex flex-col w-full" />
          </div>
        </div>
      </div>
    </div>
  )
}

export default Loading
