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
      </Flex>
      <Flex
        justify="between"
        className="absolute w-full pb-2 pl-4 border-b border-dashed top-10 border-gray-5"
      >
        <div className="flex items-baseline w-full">{clue}</div>
      </Flex>
    </>
  )
}

export default Toolbar
