import React, { useEffect, useState } from 'react'

import { type Database } from '@/lib/database.types'

type Props = {
  since: number
  statusOfGame:
    | Database['public']['Tables']['status_of_game']['Row']
    | undefined
}

const Timer: React.FC<Props> = ({ since, statusOfGame }) => {
  const [time, setTime] = useState<number>(0)

  useEffect(() => {
    if (statusOfGame?.status === 'completed') {
      if (!statusOfGame.game_ended_at) return
      setTime(new Date(statusOfGame.game_ended_at).getTime() - since)
      return
    }
    const interval = setInterval(() => {
      setTime(Date.now() - since)
    }, 1000)
    return () => {
      clearInterval(interval)
    }
  }, [since, statusOfGame])

  const calculateDuration = (ms: number) => {
    let remaining = ms

    const msInYear = 1000 * 60 * 60 * 24 * 365
    const years = Math.floor(remaining / msInYear)
    remaining %= msInYear

    const msInWeek = 1000 * 60 * 60 * 24 * 7
    const weeks = Math.floor(remaining / msInWeek)
    remaining %= msInWeek

    const msInDay = 1000 * 60 * 60 * 24
    const days = Math.floor(remaining / msInDay)
    remaining %= msInDay

    const msInHour = 1000 * 60 * 60
    const hours = Math.floor(remaining / msInHour)
    remaining %= msInHour

    const msInMinute = 1000 * 60
    const minutes = Math.floor(remaining / msInMinute)
    remaining %= msInMinute

    const seconds = Math.floor(remaining / 1000)

    return { years, weeks, days, hours, minutes, seconds }
  }

  const formatTime = ({
    years,
    weeks,
    days,
    hours,
    minutes,
    seconds,
  }: {
    years: number
    weeks: number
    days: number
    hours: number
    minutes: number
    seconds: number
  }) => {
    if (years > 0) return `${years}y ${weeks}w`
    if (weeks > 0) return `${weeks}w ${days}d`
    if (days > 0) {
      return `${days}d ${hours.toString().padStart(2, '0')}:${minutes
        .toString()
        .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    }
    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }

  return <>{formatTime(calculateDuration(time))}</>
}

export default Timer
