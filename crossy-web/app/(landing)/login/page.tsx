import { Text } from '@radix-ui/themes'

import { type Database } from '@/lib/database.types'
import {
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

  if (!redirectLink) {
    return {
      title: 'Login',
    }
  }

  // if redirectLink is an array
  if (Array.isArray(redirectLink)) {
    return {
      title: 'Login',
    }
  }

  const gameId = redirectLink.split('games/').pop()?.split('?').shift()

  if (!gameId) {
    return {
      title: 'Login',
    }
  }

  const supabase = dangerouslyCreateServiceRoleClient<Database>()

  const { data: game, error: gameError } = await supabase
    .from('games')
    .select('*, puzzles(*)')
    .eq('id', gameId)
    .single()

  console.log(game)

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
        description: 'Solve crosswords together!',
        url: 'https://crossy.me',
        siteName: 'Crossy',
      },
      twitter: {
        card: 'summary_large_image',
        title: `${game?.puzzles?.name} — Crossy`,
        description: 'Solve crosswords together!',
        creator: '@eamonma',
        images: [`${url}api/og?game=${game.id}`],
      },
    }
  }
}

export default function Login({
  searchParams,
}: {
  searchParams: { message: string }
}) {
  return (
    <div className="flex items-center self-center justify-center w-full h-full bg-gray-50">
      {/* <RadixLink className="absolute flex items-center top-4 left-4" asChild>
        <Link href="/">
          <ArrowLeftIcon className="mr-1" />
          Back
        </Link>
      </RadixLink> */}

      <div className="flex flex-col w-full max-w-sm p-4 border border-gray-300 rounded-lg shadow-sm bg-gray-25">
        <div className="flex justify-between ">
          <Text asChild>
            <span className="font-serif text-lg font-bold">Crossy</span>
          </Text>
          <Text asChild>
            <span className="font-serif text-lg">Sign in</span>
          </Text>
        </div>
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
