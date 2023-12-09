import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export const createClient = <T>(cookieStore: ReturnType<typeof cookies>) => {
  return createServerClient<T>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options })
          } catch (error) {
            // The `set` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options })
          } catch (error) {
            // The `delete` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    },
  )
}

export const dangerouslyCreateServiceRoleClient = <T>() => {
  // return createServerClient<T>(
  //   process.env.NEXT_PUBLIC_SUPABASE_URL!,
  //   process.env.SUPABASE_SERVICE_ROLE_KEY!,
  //   {
  //     cookies: {
  //       get(name: string) {
  //         return cookieStore.get(name)?.value
  //       },
  //       set(name: string, value: string, options: CookieOptions) {
  //         try {
  //           cookieStore.set({ name, value, ...options })
  //         } catch (error) {
  //           // The `set` method was called from a Server Component.
  //           // This can be ignored if you have middleware refreshing
  //           // user sessions.
  //         }
  //       },
  //       remove(name: string, options: CookieOptions) {
  //         try {
  //           cookieStore.set({ name, value: '', ...options })
  //         } catch (error) {
  //           // The `delete` method was called from a Server Component.
  //           // This can be ignored if you have middleware refreshing
  //           // user sessions.
  //         }
  //       },
  //     },
  //   },
  // )

  return createSupabaseClient<T>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}
