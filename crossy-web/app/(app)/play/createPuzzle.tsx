'use client'
import React, { useState } from 'react'
import { FilePlusIcon } from '@radix-ui/react-icons'
import { Dialog, Link } from '@radix-ui/themes'
import { useRouter } from 'next/navigation'

import Create from './puzzles/create/create'

type Props = {
  children?: React.ReactNode
  onComplete?: (id: string) => void
}

const CreatePuzzle: React.FC<Props> = ({
  children,
  onComplete: _onComplete,
}) => {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  const defaultOnComplete = (id: string) => {
    setOpen(false)
    router.push(`/play/puzzles/${id}`)
  }

  const wrappedOnComplete = (id: string) => {
    setOpen(false)
    _onComplete && _onComplete(id)
  }

  const onComplete = _onComplete ? wrappedOnComplete : defaultOnComplete

  const onCancel = () => {
    setOpen(false)
  }

  children = children ?? (
    <Link asChild className="flex items-center w-full gap-2 font-medium">
      <button>
        <FilePlusIcon />
        Create puzzle
      </button>
    </Link>
  )

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(open) => {
        setOpen(open)
      }}
    >
      <Dialog.Trigger>{children}</Dialog.Trigger>
      <Dialog.Content style={{ maxWidth: 450 }}>
        <Create onComplete={onComplete} onCancel={onCancel} />
      </Dialog.Content>
    </Dialog.Root>
  )
}

export default CreatePuzzle
