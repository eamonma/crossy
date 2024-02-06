'use client'
import React, { useState } from 'react'
import { Button } from '@radix-ui/themes'

type Props = {
  createGame: () => void
}

const StartGameButton: React.FC<Props> = ({ createGame }) => {
  const [isLoading, setIsLoading] = useState(false)

  return (
    <form action={createGame} className="flex justify-end w-full">
      <Button
        disabled={isLoading}
        onClick={() => {
          setIsLoading(true)
          createGame()
        }}
      >
        Start a game
      </Button>
    </form>
  )
}

export default StartGameButton
