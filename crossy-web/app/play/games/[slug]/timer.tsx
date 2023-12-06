import React, { useEffect, useState } from 'react'

type Props = {
  since: number
}

const Timer: React.FC<Props> = ({ since }) => {
  const [time, setTime] = useState<number>(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(Date.now() - since)
    }, 1000)
    return () => { clearInterval(interval) }
  }, [since])

  const date = new Date(time)

  const hours = date.getUTCHours().toFixed(0).padStart(2, '0')
  const minutes = date.getUTCMinutes().toFixed(0).padStart(2, '0')
  const seconds = date.getUTCSeconds().toFixed(0).padStart(2, '0')

  if (date.getUTCHours() > 0) {
    return (
      <>
        {hours}:{minutes}:{seconds}
      </>
    )
  } else {
    return (
      <>
        {minutes}:{seconds}
      </>
    )
  }
}

export default Timer
