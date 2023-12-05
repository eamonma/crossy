'use client'
import React, { useEffect, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { Cross1Icon } from '@radix-ui/react-icons'
import { Button, Heading, IconButton, Text } from '@radix-ui/themes'
import { z } from 'zod'

import CrosswordGrid from '@/components/crosswordGridDisplay'
import { type CrosswordJson, crosswordJsonSchema } from '@/lib/crosswordJson'

const getRandomGrid = (size: { cols: number; rows: number }) => {
  const selections = [
    (i: number) => {
      if (Math.floor(i) % Math.floor(size.cols / 2) === 0) return '.'
      return '#'
    },
    (i: number) => {
      if (Math.floor(i) % 4 === 0) return '.'
      return '#'
    },
    (i: number) => {
      if (Math.floor(i / 3) % 4 === 0) return '.'
      if (Math.floor(-i / 2) % 4 === 0) return '.'
      return '#'
    },
  ]
  return [...new Array(size.cols * size.rows)].map((_, i) => {
    const nthSelection = Math.floor(Math.random() * selections.length)

    return selections[nthSelection](i)
  })
}

type Props = {
  onComplete: (id: string) => void
  onCancel: () => void
}

const Create: React.FC<Props> = ({ onComplete, onCancel }) => {
  const defaultData: CrosswordJson = {
    title: '',
    circles: [],
    size: {
      rows: 15,
      cols: 15,
    },
    grid: getRandomGrid({ cols: 15, rows: 15 }),
    gridnums: [...new Array(15 * 15)].map(() => 0),
    answers: {
      across: [],
      down: [],
    },
    author: 'test',
    clues: {
      across: [],
      down: [],
    },
    date: '2021-10-18',
  }
  const [files, setFiles] = useState<File[]>([])
  const [crosswordData, setCrosswordData] = useState<CrosswordJson>(defaultData)

  const { getRootProps, getInputProps } = useDropzone({
    maxFiles: 1,
    accept: {
      'application/json': ['.json'],
    },
    onDrop: (acceptedFiles: File[]) => {
      setFiles([...acceptedFiles])
    },
  })

  useEffect(() => {
    if (files.length > 0) {
      const reader = new FileReader()
      reader.readAsText(files[0])

      reader.onload = (result) => {
        try {
          const res = crosswordJsonSchema.parse(
            JSON.parse(result.target?.result as string),
          )
          setCrosswordData(res)
        } catch (err) {
          if (err instanceof z.ZodError) {
            setFiles([])
          }
        }
      }
    }
  }, [files])

  const onClearFiles = (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    e.preventDefault()
    e.stopPropagation()
    setFiles([])
    setCrosswordData(defaultData)
  }

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    fetch('/api/puzzles', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(crosswordData),
    })
      .then(async (response) => await response.json())
      .then((data) => {
        const {
          data: { id },
        } = data
        onComplete(id)
      })
      .catch((error) => {
        console.error('Error:', error)
      })
  }

  const width = crosswordData.size.cols
  const height = crosswordData.size.rows

  let maxString = ''

  if (width >= height) {
    // Width is the limiting factor
    maxString = 'w-full'
  } else {
    // Height is the limiting factor
    maxString = 'h-full'
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col items-start h-full gap-4"
    >
      {files.length > 0 && (
        <Heading size="5" className="w-full truncate">
          {crosswordData.title}
        </Heading>
      )}
      <section className="w-full font-medium border border-dashed border-grayA-5 rounded-4">
        <div
          {...getRootProps({
            className: 'dropzone h-12 px-4 flex cursor-pointer items-center',
          })}
        >
          <input key={files.toString()} {...getInputProps()} />
          {files.length > 0 ? (
            <div className="flex items-center justify-between w-full gap-2">
              <Text className="font-mono" trim="both">
                {files[0].name}
              </Text>
              <IconButton
                size="1"
                onClick={onClearFiles}
                variant="soft"
                color="red"
              >
                <Cross1Icon />
              </IconButton>
            </div>
          ) : (
            <Text trim="both">Select a crossword JSON file</Text>
          )}
        </div>
      </section>
      <div
        className={`flex w-full justify-center items-center min-h-[40vh] transition ${
          files.length > 0 ? 'opacity-100' : 'opacity-20'
        } ${maxString}`}
      >
        <CrosswordGrid
          shouldShowNumbers={false}
          crossword={crosswordData}
          answers={[]}
        />
      </div>
      <div className="flex justify-end w-full gap-2">
        <Button type="button" onClick={onCancel} variant="surface">
          Cancel
        </Button>
        <Button disabled={files.length === 0}>Continue</Button>
      </div>
    </form>
  )
}

export default Create
