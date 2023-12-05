'use client'

import React from 'react'
import { motion } from 'framer-motion'

import CrosswordGrid, {
  type CrosswordData,
} from '@/components/crosswordGridDisplay'

type Props = {
  crosswordData: CrosswordData
}

const PuzzleContent: React.FC<Props> = ({ crosswordData }) => {
  return (
    <motion.div className="flex w-full justify-center">
      <div className="flex w-full max-h-[65vh] justify-center">
        <CrosswordGrid
          crossword={crosswordData}
          answers={[]}
          shouldShowNumbers={false}
        />
      </div>
    </motion.div>
  )
}

export default PuzzleContent
