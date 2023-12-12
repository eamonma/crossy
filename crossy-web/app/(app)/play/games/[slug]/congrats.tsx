import React, { useEffect, useState } from 'react'
import { StarFilledIcon } from '@radix-ui/react-icons'
import { Button, Dialog, Flex } from '@radix-ui/themes'

import { type Database } from '@/lib/database.types'

type Props = {
  isOpen: boolean
  status:
    | Database['public']['Tables']['status_of_game']['Row']['status']
    | undefined
}

const Congrats: React.FC<Props> = ({ isOpen, status }) => {
  const [open, setOpen] = useState(isOpen)

  useEffect(() => {
    if (isOpen) {
      setOpen(true)
    }
  }, [isOpen])

  const handleDismiss = (e?: any) => {
    e?.preventDefault()
    if (status !== 'ongoing') {
      setOpen(false)
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(newOpen) => {
        if (!newOpen) {
          if (status !== 'ongoing') {
            setOpen(false)
          }
        }
      }}
    >
      <Dialog.Content
        style={{
          maxWidth: 450,
        }}
        onFocusOutside={handleDismiss}
        onInteractOutside={handleDismiss}
        onPointerDownOutside={handleDismiss}
      >
        <Dialog.Title className="flex items-center">
          {status === 'ongoing' ? (
            'Verifying...'
          ) : (
            <>
              <StarFilledIcon
                width={18}
                height={18}
                className="mr-1 text-gold-700"
              />
              Congratulations!
            </>
          )}
        </Dialog.Title>
        <Dialog.Description size="2" mb="4">
          {status === 'completed' && "You've completed the puzzle."}
        </Dialog.Description>

        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button disabled={status === 'ongoing'} variant="soft">
              Done
            </Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}

export default Congrats
