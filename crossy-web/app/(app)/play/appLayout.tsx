'use client'
import React, { useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useWindowSize } from 'react-use'
import {
  ChevronLeftIcon,
} from '@radix-ui/react-icons'
import { IconButton, Tooltip } from '@radix-ui/themes'
import { type Session } from '@supabase/supabase-js'
import { motion, type Transition } from 'framer-motion'

import Nav from './nav'
import UserCard from './userCard'

type Props = {
  children: React.ReactNode
  session: Session
}

const transition: Transition = {
  ease: 'easeInOut',
  duration: 0.2,
}

const AppLayout: React.FC<Props> = ({ session, children }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(true)
  useHotkeys(
    'meta+shift+s, ctrl+shift+s',
    (e) => {
      e.preventDefault()
      setIsMenuOpen((prev) => !prev)
    },
    [isMenuOpen, setIsMenuOpen],
  )

  const { width } = useWindowSize()

  if (width < 640) {
    return (
      <div className="w-full bg-gray-50">
        <nav className="flex flex-col justify-between w-full h-full gap-2 p-4 pr-0">
          <Nav />
          <UserCard session={session} />
        </nav>
        <div className="relative h-full overflow-auto">{children}</div>
      </div>
    )
  }

  return (
    <div className="w-full bg-gray-50">
      <nav className="flex flex-col justify-between w-64 h-full gap-2 p-4 pr-0">
        <Nav />
        <UserCard session={session} />
      </nav>
      <motion.div
        initial={false}
        animate={{
          marginLeft: isMenuOpen ? '17rem' : '1rem',
          width: isMenuOpen ? 'calc(100vw - 18rem)' : 'calc(100vw - 2rem)',
        }}
        transition={transition}
        className="z-10 flex-1 h-[calc(100svh-2rem)] absolute inset-y-0 shadow-sm rounded-md border border-gray-300 m-4 w-full bg-gray-25"
      >
        <div className="absolute inset-y-0 z-20 top-1/2">
          <motion.div
            initial={false}
            className="absolute"
            animate={{
              left: isMenuOpen ? '-1rem' : '1rem',
            }}
            transition={transition}
          >
            <Tooltip content={'⌘+shift+s'}>
              <IconButton
                size="4"
                variant="ghost"
                onClick={() => {
                  setIsMenuOpen((prev) => !prev)
                }}
                className="absolute"
              >
                <motion.div
                  animate={{
                    rotate: isMenuOpen ? 0 : 180,
                  }}
                  transition={transition}
                  className="absolute p-2"
                >
                  <ChevronLeftIcon height={18} width={18} />
                </motion.div>
              </IconButton>
            </Tooltip>
          </motion.div>
        </div>
        <div className="relative h-full overflow-auto">{children}</div>
      </motion.div>
    </div>
  )
}

export default AppLayout
