'use client'
import React from 'react'
import { HamburgerMenuIcon } from '@radix-ui/react-icons'
import { Flex, IconButton, Popover } from '@radix-ui/themes'

import Nav from '../../nav'

type Props = {
  timer: React.ReactNode
  clue: React.ReactNode
  tools: React.ReactNode
}

const Toolbar: React.FC<Props> = ({ timer, tools, clue }) => {
  const mobileToolbar = (
    <div className="block sm:hidden">
      <Popover.Root>
        <Popover.Trigger>
          <IconButton variant="soft">
            <HamburgerMenuIcon />
          </IconButton>
        </Popover.Trigger>
        <Popover.Content align="end">
          <Nav />
          <hr className="mt-4" />
          <div className="mt-4">{tools}</div>
        </Popover.Content>
      </Popover.Root>
    </div>
  )

  return (
    <>
      <Flex
        gap="4"
        align="center"
        className="w-full px-4 py-2 border-gray-5"
        justify="between"
      >
        {timer}
        <div className="hidden sm:block">{tools}</div>
        {mobileToolbar}
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
