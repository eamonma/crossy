import React from 'react'
import { Link as RadixLink } from '@radix-ui/themes'
import NextLink from 'next/link'
type Props = React.ComponentProps<typeof RadixLink> &
React.ComponentProps<typeof NextLink>

const Link = (props: Props) => {
  return (
    <RadixLink asChild {...props}>
      <NextLink {...props}></NextLink>
    </RadixLink>
  )
}

export default Link
