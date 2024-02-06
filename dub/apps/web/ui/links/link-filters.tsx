import useDomains from "@/lib/swr/use-domains";
import useLinks from "@/lib/swr/use-links";
import useLinksCount from "@/lib/swr/use-links-count";
import useTags from "@/lib/swr/use-tags";
import { TagProps } from "@/lib/types";
import TagBadge, { COLORS_LIST } from "@/ui/links/tag-badge";
import { ThreeDots } from "@/ui/shared/icons";
import {
  IconMenu,
  LoadingCircle,
  LoadingSpinner,
  NumberTooltip,
  Popover,
  Switch,
  useMediaQuery,
  useRouterStuff,
} from "@dub/ui";
import {
  SWIPE_REVEAL_ANIMATION_SETTINGS,
  nFormatter,
  truncate,
} from "@dub/utils";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronRight, Search, Trash, XCircle } from "lucide-react";
import { useSession } from "next-auth/react";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import punycode from "punycode/";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { mutate } from "swr";
import { useDebouncedCallback } from "use-debounce";

export default function LinkFilters() {
  const { data: domains } = useLinksCount({ groupBy: "domain" });

  const { tags } = useTags();
  const { data: tagsCount } = useLinksCount({ groupBy: "tagId" });

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { queryParams } = useRouterStuff();
  const searchInputRef = useRef(); // this is a hack to clear the search input when the clear button is clicked

  useEffect(() => {
    if (searchParams?.has("search")) {
      queryParams({
        set: { showArchived: "true" },
      });
    }
  }, [pathname, searchParams]);

  const showClearButton = useMemo(() => {
    return [
      "sort",
      "search",
      "domain",
      "userId",
      "tagId",
      "showArchived",
      "page",
    ].some((param) => searchParams?.has(param));
  }, [searchParams]);

  return domains ? (
    <div className="grid w-full rounded-md bg-white px-5 lg:divide-y lg:divide-gray-300">
      <div className="grid gap-3 py-6">
        <div className="flex items-center justify-between">
          <h3 className="ml-1 mt-2 font-semibold">Filter Links</h3>
          {showClearButton && <ClearButton searchInputRef={searchInputRef} />}
        </div>
        <div className="hidden lg:block">
          <SearchBox searchInputRef={searchInputRef} />
        </div>
      </div>
      <DomainsFilter />
      {tags && tagsCount && (
        <>
          <TagsFilter tags={tags} tagsCount={tagsCount} />
          <MyLinksFilter />
          <ArchiveFilter />
        </>
      )}
    </div>
  ) : (
    <div className="grid h-full gap-6 rounded-md bg-white p-5">
      <div className="h-[400px] w-full animate-pulse rounded-md bg-gray-200" />
    </div>
  );
}

const ClearButton = ({ searchInputRef }) => {
  const router = useRouter();
  const { slug } = useParams() as { slug?: string };
  return (
    <button
      onClick={() => {
        router.replace(`/${slug || "links"}`);
        searchInputRef.current.value = "";
      }}
      className="group flex items-center justify-center space-x-1 rounded-md border border-gray-400 px-2 py-1 transition-all hover:border-gray-600 active:bg-gray-100"
    >
      <XCircle className="h-4 w-4 text-gray-500 transition-all group-hover:text-black" />
      <p className="text-sm text-gray-500 transition-all group-hover:text-black">
        Clear
      </p>
    </button>
  );
};

export const SearchBox = ({ searchInputRef }) => {
  const searchParams = useSearchParams();
  const { queryParams } = useRouterStuff();
  const debounced = useDebouncedCallback((value) => {
    queryParams({
      set: {
        search: value,
      },
      del: "page",
    });
  }, 500);
  const { isValidating } = useLinks();

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    // only focus on filter input when:
    // - user is not typing in an input or textarea
    // - there is no existing modal backdrop (i.e. no other modal is open)
    if (
      e.key === "/" &&
      target.tagName !== "INPUT" &&
      target.tagName !== "TEXTAREA"
    ) {
      e.preventDefault();
      searchInputRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
        {isValidating && searchInputRef.current?.value.length > 0 ? (
          <LoadingSpinner className="h-4 w-4" />
        ) : (
          <Search className="h-4 w-4 text-gray-400" />
        )}
      </div>
      <input
        ref={searchInputRef}
        type="text"
        className="peer w-full rounded-md border border-gray-300 px-10 text-black placeholder:text-gray-400 focus:border-black focus:ring-0 sm:text-sm"
        placeholder="Search..."
        defaultValue={searchParams?.get("search") || ""}
        onChange={(e) => {
          debounced(e.target.value);
        }}
      />
      {searchInputRef.current?.value.length > 0 && (
        <button
          onClick={() => {
            searchInputRef.current.value = "";
            queryParams({ del: "search" });
          }}
          className="pointer-events-auto absolute inset-y-0 right-0 flex items-center pr-4 lg:hidden"
        >
          <XCircle className="h-4 w-4 text-gray-600" />
        </button>
      )}
    </div>
  );
};

const DomainsFilter = () => {
  const searchParams = useSearchParams();
  const { queryParams } = useRouterStuff();
  const { data: domains } = useLinksCount({ groupBy: "domain" });
  const { primaryDomain } = useDomains();

  const [collapsed, setCollapsed] = useState(false);

  const options = useMemo(() => {
    return domains?.length === 0
      ? [
          {
            value: primaryDomain,
            count: 0,
          },
        ]
      : domains?.map(({ domain, _count }) => ({
          value: domain,
          count: _count,
        }));
  }, [domains, primaryDomain]);

  return (
    <fieldset className="overflow-hidden py-6">
      <div className="flex h-8 items-center justify-between">
        <button
          onClick={() => {
            setCollapsed(!collapsed);
          }}
          className="flex items-center space-x-2"
        >
          <ChevronRight
            className={`${collapsed ? "" : "rotate-90"} h-5 w-5 transition-all`}
          />
          <h4 className="font-medium text-gray-900">Domains</h4>
        </button>
      </div>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            className="mt-4 grid gap-2"
            {...SWIPE_REVEAL_ANIMATION_SETTINGS}
          >
            {options?.map(({ value, count }) => (
              <div
                key={value}
                className="relative flex cursor-pointer items-center space-x-3 rounded-md bg-gray-50 transition-all hover:bg-gray-100"
              >
                <input
                  id={value}
                  name={value}
                  checked={
                    searchParams?.get("domain") === value ||
                    domains?.length <= 1
                  }
                  onChange={() => {
                    queryParams({
                      set: {
                        domain: value,
                      },
                      del: "page",
                    });
                  }}
                  type="radio"
                  className="ml-3 h-4 w-4 cursor-pointer rounded-full border-gray-300 text-black focus:outline-none focus:ring-0"
                />
                <label
                  htmlFor={value}
                  className="flex w-full cursor-pointer justify-between px-3 py-2 pl-0 text-sm font-medium text-gray-700"
                >
                  <p>{truncate(punycode.toUnicode(value || ""), 24)}</p>
                  <NumberTooltip value={count} unit="links">
                    <p className="text-gray-500">{nFormatter(count)}</p>
                  </NumberTooltip>
                </label>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </fieldset>
  );
};

const TagsFilter = ({
  tags,
  tagsCount,
}: {
  tags: TagProps[];
  tagsCount: { tagId: string; _count: number }[];
}) => {
  const searchParams = useSearchParams();
  const { queryParams } = useRouterStuff();
  const [collapsed, setCollapsed] = useState(tags.length === 0 ? true : false);
  const [search, setSearch] = useState("");
  const [showMore, setShowMore] = useState(false);

  const options = useMemo(() => {
    const initialOptions = tags
      .map((tag) => ({
        ...tag,
        count: tagsCount.find(({ tagId }) => tagId === tag.id)?._count || 0,
      }))
      .sort((a, b) => b.count - a.count);
    // filter options based on search
    return search.length > 0
      ? initialOptions.filter(({ name }) =>
          name.toLowerCase().includes(search.toLowerCase()),
        )
      : initialOptions;
  }, [tagsCount, tags, search]);

  return (
    <fieldset className="overflow-hidden py-6">
      <div className="flex h-8 items-center justify-between">
        <button
          onClick={() => {
            setCollapsed(!collapsed);
          }}
          className="flex items-center space-x-2"
        >
          <ChevronRight
            className={`${collapsed ? "" : "rotate-90"} h-5 w-5 transition-all`}
          />
          <h4 className="font-medium text-gray-900">Tags</h4>
        </button>
      </div>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            className="mt-4 grid gap-2"
            {...SWIPE_REVEAL_ANIMATION_SETTINGS}
          >
            {tags?.length === 0 ? ( // if the project has no tags
              <p className="text-center text-sm text-gray-500">No tags yet.</p>
            ) : (
              <>
                <div className="relative mb-1">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <Search className="h-4 w-4 text-gray-400" />
                  </div>
                  <input
                    type="text"
                    className="peer w-full rounded-md border border-gray-300 py-1.5 pl-10 text-sm text-black placeholder:text-gray-400 focus:border-black focus:ring-0"
                    placeholder="Filter tags"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                {options.length === 0 && (
                  <p className="mt-1 text-center text-sm text-gray-500">
                    No tags match your search.
                  </p>
                )}
              </>
            )}
            {options
              .slice(0, showMore ? options.length : 4)
              .map(({ id, name, color, count }) => (
                <div
                  key={id}
                  className="group relative flex cursor-pointer items-center space-x-3 rounded-md bg-gray-50 transition-all hover:bg-gray-100"
                >
                  <input
                    id={id}
                    name={id}
                    checked={searchParams?.get("tagId") === id}
                    onChange={() => {
                      queryParams({
                        set: {
                          tagId: id,
                        },
                        del: "page",
                      });
                    }}
                    type="radio"
                    className="ml-3 h-4 w-4 cursor-pointer rounded-full border-gray-300 text-black focus:outline-none focus:ring-0"
                  />
                  <label
                    htmlFor={id}
                    className="flex w-full cursor-pointer justify-between px-3 py-1.5 pl-0 text-sm font-medium text-gray-700"
                  >
                    <TagBadge name={name} color={color} />
                    <TagPopover tag={{ id, name, color }} count={count} />
                  </label>
                </div>
              ))}
            {options.length > 4 && (
              <button
                onClick={() => setShowMore(!showMore)}
                className="rounded-md border border-gray-300 p-1 text-center text-sm"
              >
                Show {showMore ? "less" : "more"}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </fieldset>
  );
};

const TagPopover = ({ tag, count }: { tag: TagProps; count: number }) => {
  const { slug } = useParams() as { slug?: string };
  const [data, setData] = useState(tag);
  const [openPopover, setOpenPopover] = useState(false);
  const [processing, setProcessing] = useState(false);

  const handleEdit = async (e) => {
    e.stopPropagation();
    e.preventDefault();
    setProcessing(true);
    fetch(`/api/projects/${slug}/tags/${tag.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    }).then(async (res) => {
      setProcessing(false);
      if (res.ok) {
        await mutate(`/api/projects/${slug}/tags`);
        toast.success("Tag updated");
      } else {
        toast.error("Something went wrong");
      }
    });
  };

  const handleDelete = async () => {
    setProcessing(true);
    fetch(`/api/projects/${slug}/tags/${tag.id}`, {
      method: "DELETE",
    }).then(async (res) => {
      if (res.ok) {
        await mutate(`/api/projects/${slug}/tags`);
        toast.success("Tag deleted");
      } else {
        toast.error("Something went wrong");
      }
      setProcessing(false);
    });
  };

  const { isMobile } = useMediaQuery();

  return processing ? (
    <div className="flex h-6 items-center justify-center">
      <LoadingCircle />
    </div>
  ) : (
    <Popover
      content={
        <div className="flex w-48 flex-col divide-y divide-gray-200">
          <div className="p-2">
            <form
              onClick={(e) => e.stopPropagation()} // prevent triggering <Command.Item> onClick
              onKeyDown={(e) => e.stopPropagation()} // prevent triggering <Command.Item> onKeyDown
              onSubmit={handleEdit}
              className="relative py-1"
            >
              <div className="my-2 flex items-center justify-between px-3">
                <p className="text-xs text-gray-500">Edit Tag</p>
                {data !== tag && (
                  <button className="text-xs text-gray-500">Save</button>
                )}
              </div>
              <input
                type="text"
                autoFocus={!isMobile}
                required
                onKeyDown={(e) => {
                  // if ESC key pressed, close popover
                  if (e.key === "Escape") {
                    setOpenPopover(false);
                  }
                }}
                value={data.name}
                onChange={(e) => setData({ ...data, name: e.target.value })}
                className="block w-full rounded-md border-gray-300 py-1 pr-7 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-500 focus:outline-none focus:ring-gray-500"
              />
              <div className="grid grid-cols-3 gap-3 p-3 pb-0">
                {COLORS_LIST.map(({ color, css }) => (
                  <button
                    key={color}
                    type="button"
                    className={`mx-auto flex h-6 w-6 items-center justify-center rounded-full transition-all duration-75 hover:scale-110 active:scale-90 ${css}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setData({ ...data, color });
                    }}
                  >
                    {data.color === color && <Check className="h-4 w-4" />}
                  </button>
                ))}
              </div>
            </form>
          </div>
          <div className="p-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                confirm(
                  "Are you sure you want to delete this tag? All tagged links will be untagged, but they won't be deleted.",
                ) && handleDelete();
              }}
              className="flex w-full items-center space-x-2 rounded-md p-2 text-red-600 transition-colors hover:bg-red-100 active:bg-red-200"
            >
              <IconMenu
                text="Delete Tag"
                icon={<Trash className="h-4 w-4 text-red-600" />}
              />
            </button>
          </div>
        </div>
      }
      align="end"
      openPopover={openPopover}
      setOpenPopover={setOpenPopover}
    >
      <button
        type="button"
        onClick={() => setOpenPopover(!openPopover)}
        className={`${
          openPopover ? "bg-gray-200" : "hover:bg-gray-200"
        } -mr-1 flex h-6 w-5 items-center justify-center rounded-md transition-colors`}
      >
        <ThreeDots
          className={`h-4 w-4 text-gray-500 ${
            openPopover ? "" : "hidden group-hover:block"
          }`}
        />
        <p
          className={`text-gray-500 ${
            openPopover ? "hidden" : "group-hover:hidden"
          }`}
        >
          {nFormatter(count)}
        </p>
      </button>
    </Popover>
  );
};

const MyLinksFilter = () => {
  const searchParams = useSearchParams();
  const { queryParams } = useRouterStuff();
  const userId = searchParams?.get("userId");
  const { data: session } = useSession();

  return (
    <div className="flex items-center justify-between py-6">
      <label className="text-sm font-medium text-gray-600">
        Show my links only
      </label>
      <Switch
        fn={() =>
          queryParams(
            userId
              ? { del: "userId" }
              : {
                  set: {
                    // @ts-ignore
                    userId: session?.user?.id,
                  },
                },
          )
        }
        checked={userId ? true : false}
      />
    </div>
  );
};

const ArchiveFilter = () => {
  const searchParams = useSearchParams();
  const { queryParams } = useRouterStuff();
  const showArchived = searchParams?.get("showArchived");
  return (
    <div className="flex items-center justify-between py-6">
      <label className="text-sm font-medium text-gray-600">
        Include archived links
      </label>
      <Switch
        fn={() =>
          queryParams(
            showArchived
              ? { del: "showArchived" }
              : {
                  set: {
                    showArchived: "true",
                  },
                },
          )
        }
        checked={showArchived ? true : false}
      />
    </div>
  );
};
