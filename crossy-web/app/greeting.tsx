'use client'

import { useEffect, useState } from 'react'

type Props = {
  name: string | undefined
}
const Greeting: React.FC<Props> = ({ name }) => {
  const [greeting, setGreeting] = useState('')

  useEffect(() => {
    const timeOfDay = new Date().getHours()
    if (timeOfDay < 4) {
      setGreeting('Good night')
    } else if (timeOfDay < 12) {
      setGreeting('Good morning')
    } else if (timeOfDay < 18) {
      setGreeting('Good afternoon')
    } else {
      setGreeting('Good evening')
    }
  }, [])

  return (
    <>
      {greeting}
      {greeting && name ? `, ${name}` : ''}
    </>
  )
}

export default Greeting
