export async function POST(request: Request): Promise<Response> {
  const params = await request.json()

  params.signature = process.env.YOURLS_API_KEY
  params.action = 'shorturl'
  params.format = 'json'

  // Create a URL object
  const baseUrl = 'https://crossy.ing/yourls-api.php'
  const url = new URL(baseUrl)
  // Append search parameters
  Object.keys(params).forEach((key) =>
    url.searchParams.append(key, params[key as keyof typeof params]),
  )

  const { shorturl } = await (await fetch(url)).json()

  return Response.json({ data: shorturl })
}
