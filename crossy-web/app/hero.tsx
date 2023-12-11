'use client'
import React, { type MouseEvent } from 'react'
import { ArrowRightIcon } from '@radix-ui/react-icons'
import { Button } from '@radix-ui/themes'
import { motion, useMotionTemplate, useMotionValue } from 'framer-motion'
import Link from 'next/link'

type Props = {
  isLoggedIn: boolean
}

const Hero: React.FC<Props> = ({ isLoggedIn }) => {
  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)

  function handleMouseMove({ currentTarget, clientX, clientY }: MouseEvent) {
    const { left, top } = currentTarget.getBoundingClientRect()

    mouseX.set(clientX - left)
    mouseY.set(clientY - top)
  }

  const link = isLoggedIn ? '/play' : '/login'

  return (
    <Link href={link} className="flex w-full">
      <div
        className="relative flex flex-col items-start justify-center w-full overflow-hidden border border-gray-300 rounded-md shadow-sm bg-gold-25 group"
        onMouseMove={handleMouseMove}
      >
        <motion.div
          className="absolute transition opacity-0 pointer-events-none -inset-px group-hover:opacity-100"
          style={{
            background: useMotionTemplate`
            radial-gradient(
              750px circle at ${mouseX}px ${mouseY}px,
              rgba(255, 255, 255, 0.2),
              transparent 80%
            )
          `,
          }}
        ></motion.div>
        <div className="w-full">
          <h2 className="w-full h-full font-serif font-medium leading-[clamp(3rem,9vw,10rem)] text-[clamp(4rem,12vw,12rem)] text-[var(--gold-12)]">
            <div className="text-[var(--gray-11)]">
              <span className="pl-[15%]">
                Solve
                <hr className="border-dashed" />
              </span>
              <span className="pl-[15%]">
                crosswords
                <hr className="border-dashed" />
              </span>
            </div>
            <span className="pl-[15%]">
              together.
              <hr className="border-dashed" />
            </span>
          </h2>
          <div className="flex flex-col items-start max-w-md gap-4 px-4 pl-[15%]">
            <Button>
              {isLoggedIn ? (
                <>
                  Play <ArrowRightIcon />
                </>
              ) : (
                <>
                  Sign in to play <ArrowRightIcon />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </Link>
  )
}

export default Hero
