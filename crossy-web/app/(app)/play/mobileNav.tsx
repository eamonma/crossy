'use client'
import React from 'react'
import { DotFilledIcon, FileIcon, HamburgerMenuIcon, HomeIcon } from '@radix-ui/react-icons'
import { IconButton, Link as RadixLink, Popover } from '@radix-ui/themes'
import NextLink from 'next/link'

import CrossyLogo from '@/components/crossyLogo'

import Link from './activeLink'
import CreatePuzzle from './createPuzzle'

const MobileNav = () => {
  return (
    <div className="flex items-center justify-between w-full gap-4 p-2 px-4">
      <NextLink href="/">
        <h1 className="flex items-center justify-center gap-1 font-serif text-lg font-bold text-center">
          <div className="w-6 h-6 text-white rounded-full bg-gold-800 p-0.5">
            <CrossyLogo />
          </div>
          Crossy
        </h1>
      </NextLink>

      <Popover.Root>
        <Popover.Trigger>
          <IconButton variant="ghost">
            <HamburgerMenuIcon />
          </IconButton>
        </Popover.Trigger>
        <Popover.Content align="end">
          <ul className="flex flex-col gap-4">
            <li>
              <Link href="/play" className="flex items-center gap-2">
                <HomeIcon />
                Home
              </Link>
            </li>
            <li>
              <Link href="/play/puzzles" className="flex items-center gap-2">
                <FileIcon />
                Puzzles
              </Link>
            </li>
            <li>
              <CreatePuzzle />
            </li>

            <hr className="border-dashed" />
            <div className="flex items-center gap-2 text-xs">
              <RadixLink asChild>
                <NextLink href="/privacy">Privacy policy</NextLink>
              </RadixLink>
              <DotFilledIcon className="text-accent" />

              <RadixLink asChild>
                <NextLink href="/terms">Terms of use</NextLink>
              </RadixLink>
            </div>
          </ul>
        </Popover.Content>
      </Popover.Root>
      {/* <hr className="-mt-2 border-dashed" /> */}
    </div>
  )
}

export default MobileNav
