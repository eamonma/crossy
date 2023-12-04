'use client'
import React, { useState } from 'react'
import { FilePlusIcon } from '@radix-ui/react-icons'
import { Dialog, Link } from '@radix-ui/themes'
import { useRouter } from 'next/navigation'

import Create from './puzzles/create/create'

const CreatePuzzle = () => {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  const onComplete = (id: string) => {
    setOpen(false)
    router.push(`/play/puzzles/${id}`)
  }

  const onCancel = () => {
    setOpen(false)
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(open) => {
        setOpen(open)
      }}
    >
      <Dialog.Trigger>
        <Link asChild className="flex font-medium items-center gap-2 w-full">
          <button>
            <FilePlusIcon />
            Create puzzle
          </button>
        </Link>
      </Dialog.Trigger>
      <Dialog.Content style={{ maxWidth: 450 }}>
        {/* <Dialog.Title>Create puzzle</Dialog.Title> */}
        <Create onComplete={onComplete} onCancel={onCancel} />
      </Dialog.Content>
    </Dialog.Root>
  )
}

export default CreatePuzzle
