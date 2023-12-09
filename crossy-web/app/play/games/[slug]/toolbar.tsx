import React from 'react'
import { Flex } from '@radix-ui/themes'

type Props = {
  top: React.ReactNode
  clue: React.ReactNode
}

const Toolbar: React.FC<Props> = ({ top, clue }) => {
  return (
    <>
      <Flex
        gap="4"
        align="center"
        className="w-full px-4 py-2 border-gray-5"
        justify="between"
      >
        {top}
        {/* <time className="text-gray-10">
          <Timer since={new Date(game.created_at).getTime()} />
        </time>
        <Flex gap="4" align="center"> */}
        {/* <OnlineUsers userIds={onlineUserIds} />
          <ShareLink game={game} /> */}
        {/* </Flex> */}
      </Flex>
      <Flex
        justify="between"
        className="absolute w-full pb-2 pl-4 border-b border-dashed top-10 border-gray-5"
      >
        <div className="flex items-baseline w-full">
          {clue}
          {/* <div className="flex items-center text-left w-[5ch] text-gray-10">
            <Text>{clueNum}</Text>
            {currentDirection === 'across' ? 'A' : 'D'}
          </div>
          <Text className="relative flex-1 pr-4 text-left">
            {parse(clueNumToClue(clueNum, currentDirection) ?? '')}
            {clue}
          </Text> */}
        </div>
      </Flex>
    </>
  )
}

export default Toolbar
