"use client";

import { NumberTooltip, Tooltip, useMediaQuery } from "@dub/ui";
import { cn, nFormatter } from "@dub/utils";
import { motion } from "framer-motion";
import { Search } from "lucide-react";
import Link from "next/link";
import { Dispatch, ReactNode, SetStateAction, useMemo, useState } from "react";
import LinkPreviewTooltip from "./link-preview";

export default function BarList({
  tab,
  data,
  barBackground,
  maxClicks,
  setShowModal,
  limit,
}: {
  tab: string;
  data: {
    icon?: ReactNode;
    title: string;
    href: string;
    clicks: number;
  }[];
  maxClicks: number;
  barBackground: string;
  setShowModal: Dispatch<SetStateAction<boolean>>;
  limit?: number;
}) {
  const [search, setSearch] = useState("");

  const filteredData = useMemo(() => {
    if (limit) {
      return data.slice(0, limit);
    } else {
      return search
        ? data.filter((d) =>
            d.title.toLowerCase().includes(search.toLowerCase()),
          )
        : data;
    }
  }, [data, limit, search]);

  const { isMobile } = useMediaQuery();

  const bars = (
    <div className="grid gap-4">
      {filteredData.map(({ icon, title, href, clicks }, idx) => {
        const lineItem = (
          <div className="z-10 flex items-center space-x-2 px-2">
            {icon}
            <p
              className={cn(
                "text-sm text-gray-800",
                href && "underline-offset-4 group-hover:underline",
              )}
            >
              {title}
            </p>
          </div>
        );

        return (
          <Link
            key={idx}
            href={href}
            scroll={false}
            onClick={() => setShowModal(false)}
          >
            <div key={idx} className="group flex items-center justify-between">
              <div className="relative z-10 flex w-full max-w-[calc(100%-2rem)] items-center">
                {tab === "Top Links" ? (
                  <Tooltip content={<LinkPreviewTooltip link={title} />}>
                    {lineItem}
                  </Tooltip>
                ) : (
                  lineItem
                )}
                <motion.div
                  style={{
                    width: `${(clicks / (maxClicks || 0)) * 100}%`,
                  }}
                  className={cn(
                    "absolute h-8 origin-left rounded-sm",
                    barBackground,
                  )}
                  transition={{ ease: "easeOut", duration: 0.3 }}
                  initial={{ transform: "scaleX(0)" }}
                  animate={{ transform: "scaleX(1)" }}
                />
              </div>
              <NumberTooltip value={clicks}>
                <p className="z-10 text-sm text-gray-600">
                  {nFormatter(clicks)}
                </p>
              </NumberTooltip>
            </div>
          </Link>
        );
      })}
    </div>
  );

  if (limit) {
    return bars;
  } else {
    return (
      <>
        <div className="relative p-4">
          <div className="pointer-events-none absolute inset-y-0 left-7 flex items-center">
            <Search className="h-4 w-4 text-gray-400" />
          </div>
          <input
            type="text"
            autoFocus={!isMobile}
            className="w-full rounded-md border border-gray-300 py-2 pl-10 text-black placeholder:text-gray-400 focus:border-black focus:outline-none focus:ring-gray-600 sm:text-sm"
            placeholder={`Search ${tab}...`}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div>
          <div className="flex justify-between px-4 pb-1 pt-0">
            <p className="text-xs font-semibold uppercase text-gray-600">
              {tab}
            </p>
            <p className="text-xs font-semibold uppercase text-gray-600">
              Clicks
            </p>
          </div>
          <div className="h-[50vh] overflow-auto p-4 md:h-[40vh]">{bars}</div>
        </div>
      </>
    );
  }
}
