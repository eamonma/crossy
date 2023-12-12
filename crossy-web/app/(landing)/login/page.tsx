import { Text } from '@radix-ui/themes'

import Form from './loginForm'
import Main from './main'

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
