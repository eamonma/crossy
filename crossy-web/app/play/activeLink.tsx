'use client'
import { ThickArrowLeftIcon } from '@radix-ui/react-icons'
import { usePathname } from 'next/navigation'

import LinkBase from '@/components/Link'

const Link = (props: React.ComponentProps<typeof LinkBase>) => {
  const pathname = usePathname()
  const isActive = pathname === props.href
  const { children, ...rest } = props

  return (
    <LinkBase weight="medium" color={isActive ? 'gray' : undefined} {...rest}>
      {children}
      {isActive && <ThickArrowLeftIcon />}
    </LinkBase>
  )
}

export default Link
