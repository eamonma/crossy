'use client'
import React from 'react'
import { DiscordLogoIcon, GitHubLogoIcon } from '@radix-ui/react-icons'
import { Button, Link as RadixLink, Text } from '@radix-ui/themes'
import { type Provider } from '@supabase/supabase-js'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

import AppleLogo from '@/components/appleLogo'
import MsftLogo from '@/components/msftLogo'
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
  const redirectTo = searchParams.get('redirectTo')
  const appendix = redirectTo ? `?redirectTo=${redirectTo}` : ''

  const signInWithProvider = async (provider: Provider, scopes?: string) => {
    const redirectUrl = `${getURL()}auth/callback${appendix}`

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: redirectUrl,
        // scopes: 'email,profile',
        scopes,
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
      name: 'Continue with Microsoft',
      icon: MsftLogo,
      provider: 'azure',
      scopes: 'email,profile',
    },
    {
      name: 'Continue with Apple',
      icon: AppleLogo,
      provider: 'apple',
    },
    {
      name: 'Continue with Discord',
      icon: DiscordLogoIcon,
      provider: 'discord',
    },
    {
      name: 'Continue with GitHub',
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
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {providers.map(({ name, icon: Icon, provider, scopes }) => (
          <Button
            key={provider}
            className="flex items-center gap-2 cursor-pointer"
            onClick={async () => {
              await signInWithProvider(provider as Provider, scopes)
            }}
          >
            <Icon />
            {/* {name} */}
          </Button>
        ))}
      </div>
      <div className="mt-2 text-sm">
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
