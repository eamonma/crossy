import React, { useEffect, useState } from 'react'
import { Button, Dialog, Flex } from '@radix-ui/themes'

type Props = {
  isOpen: boolean
}

const Congrats: React.FC<Props> = ({ isOpen }) => {
  const [open, setOpen] = useState(isOpen)

  useEffect(() => {
    if (isOpen) {
      setOpen(true)
    }
  }, [isOpen])

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Content
        style={{
          maxWidth: 450,
        }}
      >
        <Dialog.Title>Congratulations!</Dialog.Title>
        <Dialog.Description size="2" mb="4">
          You've completed the puzzle.
        </Dialog.Description>

        {/* <div className="flex flex-col gap-2"> */}
        {/* <label>
            <Text as="div" size="2" mb="1" weight="bold">
              Name
            </Text>
            <TextField.Input
              defaultValue="Freja Johnsen"
              placeholder="Enter your full name"
            />
          </label>
          <label>
            <Text as="div" size="2" mb="1" weight="bold">
              Email
            </Text>
            <TextField.Input
              defaultValue="freja@example.com"
              placeholder="Enter your email"
            />
          </label> */}
        {/* </div> */}

        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft">Done</Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}

export default Congrats
