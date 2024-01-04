import { Text } from '@radix-ui/themes'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { type Database } from '@/lib/database.types'
import {
  createClient,
  dangerouslyCreateServiceRoleClient,
} from '@/utils/supabase/server'

import Form from './loginForm'
import Main from './main'

export const generateMetadata = async ({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) => {
  const redirectLink = searchParams?.redirectTo
  const defaultMeta = {
    title: 'Sign in',
  }

  if (!redirectLink) {
    return defaultMeta
  }

  if (Array.isArray(redirectLink)) {
    return defaultMeta
  }

  const gameId = redirectLink.split('games/').pop()?.split('?').shift()

  if (!gameId) {
    return defaultMeta
  }

  const supabase = dangerouslyCreateServiceRoleClient<Database>()

  const { data: game, error: gameError } = await supabase
    .from('games')
    .select('*, puzzles(*)')
    .eq('id', gameId)
    .single()

  if (!game && searchParams?.key) {
    return {
      title: 'Invite',
    }
  }

  if (gameError) {
    return {
      title: '404',
    }
  }

  let url = process.env.NEXT_PUBLIC_LIVE_DOMAIN ?? 'http://localhost:3000/'
  url = url.charAt(url.length - 1) === '/' ? url : `${url}/`

  if (game?.puzzles) {
    return {
      title: game?.puzzles?.name,
      openGraph: {
        images: `${url}api/og?game=${game.id}`,
        title: `${game?.puzzles?.name} — Crossy`,
        description: 'Solve crosswords together',
        url: 'https://crossy.me',
        siteName: 'Crossy',
      },
      twitter: {
        card: 'summary_large_image',
        title: `${game?.puzzles?.name} — Crossy`,
        description: 'Solve crosswords together',
        creator: '@eamonma',
        images: [`${url}api/og?game=${game.id}`],
      },
    }
  }
}

const Login = async ({
  searchParams,
}: {
  searchParams: { message: string }
}) => {
  const cookieStore = cookies()
  const supabase = createClient<Database>(cookieStore)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect('/play')
  }

  return (
    <div className="flex items-center self-center justify-center w-full h-full bg-gray-50">
      <div className="flex flex-col w-full max-w-sm p-4 border border-gray-300 rounded-lg shadow-sm bg-gray-25">
        <Text asChild>
          <span className="font-serif text-lg">Sign in</span>
        </Text>

        <hr className="my-3" />
        <Main />

        {searchParams?.message && (
          <>
            <hr className="my-4" />
            <p className="mb-4 text-center bg-foreground/10 text-foreground">
              {searchParams.message}
            </p>
          </>
        )}

        <Form />
      </div>
    </div>
  )
}

export default Login
