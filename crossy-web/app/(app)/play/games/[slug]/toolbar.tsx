'use client'
import React from 'react'
import { Button, Flex, Popover } from '@radix-ui/themes'

type Props = {
  left: React.ReactNode
  clue: React.ReactNode
  tools: React.ReactNode
  alwaysVisibleTools?: React.ReactNode
}

const Toolbar: React.FC<Props> = ({
  left,
  tools,
  clue,
  alwaysVisibleTools,
}) => {
  const mobileToolbar = (
    <div className="flex items-center gap-2 sm:hidden">
      <Popover.Root>
        <Popover.Trigger>
          <Button variant="soft">Tools</Button>
        </Popover.Trigger>
        <Popover.Content align="end">
          <div>{tools}</div>
        </Popover.Content>
      </Popover.Root>
    </div>
  )

  return (
    <>
      <Flex
        gap="4"
        align="center"
        className="w-full py-2 pl-4 pr-2 border-gray-5"
        justify="between"
      >
        {left}
        <div className="flex items-center gap-2">
          {alwaysVisibleTools}
          <div className="hidden sm:block">{tools}</div>
          {mobileToolbar}
        </div>
      </Flex>
      <Flex
        justify="between"
        className="absolute w-full px-4 pb-2 border-b border-dashed top-10 border-gray-5"
      >
        <div className="flex items-baseline flex-1 w-full">{clue}</div>
      </Flex>
    </>
  )
}

export default Toolbar
