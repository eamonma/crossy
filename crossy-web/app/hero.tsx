'use client'
import React from 'react'
import { ArrowRightIcon } from '@radix-ui/react-icons'
import { Button } from '@radix-ui/themes'
import Link from 'next/link'

type Props = {
  isLoggedIn: boolean
}

const Hero: React.FC<Props> = ({ isLoggedIn }) => {
  const link = isLoggedIn ? '/play' : '/login'

  return (
    <div className="relative flex flex-col items-start justify-center flex-1 w-full overflow-hidden border border-gray-300 rounded-md shadow-sm bg-gold-25 group">
      <div className="w-full py-12">
        <h2 className="w-full h-full font-serif font-medium leading-[clamp(3rem,9vw,10rem)] text-[clamp(4rem,12vw,12rem)] text-[var(--gold-12)] ">
          <div className="text-[var(--gray-11)]">
            <span className="pl-[10vw]">
              Solve
              <hr className="border-dashed" />
            </span>
            <span className="pl-[10vw]">
              crosswords
              <hr className="border-dashed" />
            </span>
          </div>
          <span className="pl-[10vw]">
            together.
            <hr className="border-dashed" />
          </span>
        </h2>
        <div className="flex flex-col items-start w-full gap-4 px-4 pl-[10vw]">
          <Button asChild>
            {isLoggedIn ? (
              <Link href={link}>
                Play <ArrowRightIcon />
              </Link>
            ) : (
              <Link href={link}>
                Sign in to play <ArrowRightIcon />
              </Link>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default Hero
