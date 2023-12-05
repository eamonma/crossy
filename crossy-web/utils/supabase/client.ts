import { createBrowserClient } from '@supabase/ssr'

export const createClient = <T>() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error('Supabase URL and/or ANON KEY are not defined')
  }

  return createBrowserClient<T>(url, key)
}
