import { useEffect, useState } from 'react'

import { type Database } from '@/lib/database.types'

const useConclusion = (
  gameId: string,
  gameStatus?: Database['public']['Tables']['status_of_game']['Row']['status'],
) => {
  const [isExploding, setIsExploding] = useState(false)
  const [claimedToBeComplete, setClaimedToBeComplete] = useState(false)

  useEffect(() => {
    if (gameStatus === 'completed') {
      setClaimedToBeComplete(true)
      setIsExploding(true)
    }

    const timeout = setTimeout(() => {
      setIsExploding(false)
    }, 5000)

    return () => {
      clearTimeout(timeout)
    }
  }, [gameStatus])

  const claimComplete = () => {
    setClaimedToBeComplete(true)

    fetch('/api/games/claim-complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(gameId),
    })
      .then(async (response) => await response.json())
      .then(({ error }) => {
        if (error) {
          console.error(error)
          setClaimedToBeComplete(false)
        }
      })
      .catch((error) => {
        setClaimedToBeComplete(false)
        console.error('Error:', error)
      })
  }

  return { claimComplete, claimedToBeComplete, isExploding }
}

export default useConclusion
