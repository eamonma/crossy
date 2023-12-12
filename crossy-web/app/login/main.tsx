'use client'
import React from 'react'
import { DiscordLogoIcon, GitHubLogoIcon } from '@radix-ui/react-icons'
import { Button, Link as RadixLink, Text } from '@radix-ui/themes'
import { type Provider } from '@supabase/supabase-js'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

import { type Database } from '@/lib/database.types'
import { createClient } from '@/utils/supabase/client'

const getURL = () => {
  let url =
    process.env.NEXT_PUBLIC_LIVE_DOMAIN ??
    process?.env?.NEXT_PUBLIC_SITE_URL ?? // Set this to your site URL in production env.
    process?.env?.NEXT_PUBLIC_VERCEL_URL ?? // Automatically set by Vercel.
    'http://localhost:3000/'
  // 'http://local.qwerty.boats:3000/'
  // Make sure to include `https://` when not localhost.
  url = url.includes('http') ? url : `https://${url}`
  // Make sure to include a trailing `/`.
  url = url.charAt(url.length - 1) === '/' ? url : `${url}/`

  return url
}

const Main = () => {
  const supabase = createClient<Database>()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirectTo') ?? '/play'

  const signInWithProvider = async (provider: Provider) => {
    const redirectUrl = `${getURL()}auth/callback?redirectTo=${redirectTo}`
    console.log('redirectUrl', redirectUrl)

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: redirectUrl,
      },
    })

    if (error) {
      window.location.href = '/login?message=Could not authenticate user'
      return
    }

    window.location.href = data.url
  }

  const providers = [
    {
      name: 'Discord',
      icon: DiscordLogoIcon,
      provider: 'discord',
    },
    {
      name: 'Apple',
      icon: () => <div className="text-lg"></div>,
      provider: 'apple',
    },
    {
      name: 'GitHub',
      icon: GitHubLogoIcon,
      provider: 'github',
    },
    // {
    //   name: 'Google',
    //   icon: () => (
    //     <div className="w-4 h-4">
    //       <GoogleLogo />
    //     </div>
    //   ),
    //   provider: 'google',
    // },
  ]

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {providers.map(({ name, icon: Icon, provider }) => (
          <Button
            key={provider}
            className="flex items-center gap-2 cursor-pointer"
            onClick={async () => {
              await signInWithProvider(provider as Provider)
            }}
          >
            <Icon />
            {name}
          </Button>
        ))}
      </div>
      <div className="text-sm mt-2">
        <Text className="font-medium">
          By continuing, you agree to our{' '}
          <RadixLink asChild>
            <Link href="/terms">Terms of Service</Link>
          </RadixLink>{' '}
          and{' '}
          <RadixLink asChild>
            <Link href="/privacy">Privacy Policy</Link>
          </RadixLink>
          .
        </Text>
      </div>
    </>
  )
}

export default Main
