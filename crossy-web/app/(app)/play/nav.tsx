'use client'
import React from 'react'
import {
  DotFilledIcon,
  FileIcon,
  HomeIcon,
} from '@radix-ui/react-icons'
import { Link as RadixLink } from '@radix-ui/themes'
import NextLink from 'next/link'

import CrossyLogo from '@/components/crossyLogo'

import Link from './activeLink'
import CreatePuzzle from './createPuzzle'

const Nav = () => {
  return (
    <ul className="flex flex-col gap-4 px-2">
      <li className="">
        <NextLink href="/">
          <h1 className="flex items-center justify-center gap-1 py-2 font-serif text-lg font-bold text-center">
            <div className="w-6 h-6 text-white rounded-full bg-gold-800 p-0.5">
              <CrossyLogo />
            </div>
            Crossy
          </h1>
        </NextLink>
      </li>
      <hr className="-mt-2 border-dashed" />

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

      {/* <hr className="border-dashed" /> */}
      {/* <li>
      <RadixLink asChild>
        <a
          target="_blank"
          rel="noreferrer noopener"
          href="https://discord.com/api/oauth2/authorize?client_id=1179137043138355200&permissions=2147534912&scope=bot"
          className="flex items-center gap-2"
        >
          <DiscordLogoIcon />
          Invite Bot
          <ExternalLinkIcon />
        </a>
      </RadixLink>
    </li>
    <hr className="border-dashed" /> */}
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
  )
}

export default Nav
