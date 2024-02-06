import { getLinkViaEdge } from "@/lib/planetscale";
import Stats from "@/ui/stats";
import { constructMetadata } from "@dub/utils";
import { notFound } from "next/navigation";
import { Suspense } from "react";

export const runtime = "edge";

export async function generateMetadata({
  params,
}: {
  params: { domain: string; key: string };
}) {
  const data = await getLinkViaEdge(params.domain, params.key);

  // if the link doesn't exist or is explicitly private (publicStats === false)
  if (!data || data.publicStats === 0) {
    return;
  }

  return constructMetadata({
    title: `Stats for ${params.domain}/${params.key} – ${process.env.NEXT_PUBLIC_APP_NAME}`,
    description: `Stats page for ${params.domain}/${params.key}${
      data?.url ? `, which redirects to ${data.url}` : ""
    }.`,
    image: `https://${params.domain}/api/og/stats?domain=${params.domain}&key=${params.key}`,
  });
}

export default async function StatsPage({
  params,
}: {
  params: { domain: string; key: string };
}) {
  const data = await getLinkViaEdge(params.domain, params.key);

  if (!data || data.publicStats === 0) {
    notFound();
  }

  return (
    <div className="bg-gray-50">
      <Suspense fallback={<div className="h-screen w-full bg-gray-50" />}>
        <Stats staticDomain={params.domain} />
      </Suspense>
    </div>
  );
}
