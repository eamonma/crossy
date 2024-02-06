"use client";

import { Crisp } from "crisp-sdk-web";
import Cookies from "js-cookie";
import useProject from "@/lib/swr/use-project";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ProBanner from "../projects/pro-banner";
import { Badge, useRouterStuff } from "@dub/ui";

export default function UpgradeBanner() {
  const { slug } = useParams() as { slug?: string };

  const { id, name, plan, stripeId, createdAt } = useProject();
  const [showProBanner, setShowProBanner] = useState<boolean | null>(null);

  useEffect(() => {
    if (plan) {
      Crisp.session.setData({
        projectId: id,
        projectName: name,
        projectSlug: slug,
        plan,
        ...(stripeId && { stripeId }),
      });
      /* show pro banner if:
          - free plan
          - not hidden by user for this project 
          - project is created more than 24 hours ago
      */
      if (
        plan === "free" &&
        Cookies.get("hideProBanner") !== slug &&
        createdAt &&
        Date.now() - new Date(createdAt).getTime() > 24 * 60 * 60 * 1000
      ) {
        setShowProBanner(true);
      } else {
        setShowProBanner(false);
      }
    } else {
      setShowProBanner(false);
    }
  }, [plan, id, name, slug, stripeId, createdAt]);

  const { queryParams } = useRouterStuff();

  return (
    <>
      {showProBanner && <ProBanner setShowProBanner={setShowProBanner} />}
      {plan === "free" && showProBanner === false && (
        <button
          onClick={() =>
            queryParams({
              set: {
                upgrade: "pro",
              },
            })
          }
          className="mb-1 ml-3 hidden sm:block"
        >
          <Badge variant="rainbow" className="px-3 py-1">
            Upgrade
          </Badge>
        </button>
      )}
    </>
  );
}
