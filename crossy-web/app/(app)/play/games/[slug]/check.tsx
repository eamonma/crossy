import React from 'react'
import { CaretDownIcon } from '@radix-ui/react-icons'
import { Button, DropdownMenu } from '@radix-ui/themes'

import { type CrosswordData } from './gameboard'

type Props = {
  answers: string[]
  crosswordData: CrosswordData
  setHighlights: React.Dispatch<React.SetStateAction<Record<number, string>>>
  gameboardRef: React.RefObject<SVGSVGElement>
}

const Check: React.FC<Props> = ({
  answers,
  crosswordData,
  setHighlights,
  gameboardRef,
}) => {
  const checkPuzzle = () => {
    const wrongAnswers: Record<number, string> = {}
    for (let i = 0; i < answers.length; i++) {
      if (crosswordData.grid[i] === '.') continue
      if (!answers[i]) continue

      if (answers[i]?.charAt(0) !== crosswordData.grid[i]?.charAt(0)) {
        wrongAnswers[i] = 'var(--red-4)'
      }
    }

    setHighlights(wrongAnswers)
  }
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <Button variant="soft">
          Check
          <CaretDownIcon />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content
        onCloseAutoFocus={(e) => {
          setTimeout(() => {
            gameboardRef.current?.focus()
          }, 1)
        }}
      >
        <DropdownMenu.Item onClick={checkPuzzle}>Puzzle</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  )
}

export default Check
