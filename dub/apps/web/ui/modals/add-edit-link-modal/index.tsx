"use client";

import useDomains from "@/lib/swr/use-domains";
import useProject from "@/lib/swr/use-project";
import { BlurImage } from "@/ui/shared/blur-image";
import { AlertCircleFill, Lock, Random, X } from "@/ui/shared/icons";
import {
  Button,
  LoadingCircle,
  Logo,
  Modal,
  TooltipContent,
  useMediaQuery,
  useRouterStuff,
} from "@dub/ui";
import {
  DEFAULT_LINK_PROPS,
  GOOGLE_FAVICON_URL,
  cn,
  deepEqual,
  getApexDomain,
  getDomainWithoutWWW,
  getUrlWithoutUTMParams,
  isValidUrl,
  linkConstructor,
  truncate,
} from "@dub/utils";
import { type Link as LinkProps } from "@prisma/client";
import { useParams, usePathname, useRouter } from "next/navigation";
import punycode from "punycode/";
import {
  Dispatch,
  SetStateAction,
  UIEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { mutate } from "swr";
import { useDebounce } from "use-debounce";
import AndroidSection from "./android-section";
import CommentsSection from "./comments-section";
import ExpirationSection from "./expiration-section";
import GeoSection from "./geo-section";
import IOSSection from "./ios-section";
import OGSection from "./og-section";
import PasswordSection from "./password-section";
import Preview from "./preview";
import RewriteSection from "./rewrite-section";
import UTMSection from "./utm-section";
import TagsSection from "./tags-section";

function AddEditLinkModal({
  showAddEditLinkModal,
  setShowAddEditLinkModal,
  props,
  duplicateProps,
  homepageDemo,
}: {
  showAddEditLinkModal: boolean;
  setShowAddEditLinkModal: Dispatch<SetStateAction<boolean>>;
  props?: LinkProps;
  duplicateProps?: LinkProps;
  homepageDemo?: boolean;
}) {
  const params = useParams() as { slug?: string };
  const { slug } = params;
  const router = useRouter();
  const pathname = usePathname();

  const [keyError, setKeyError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [saving, setSaving] = useState(false);

  const {
    allActiveDomains: domains,
    primaryDomain,
    defaultDomains,
  } = useDomains();

  const [data, setData] = useState<LinkProps>(
    props ||
      duplicateProps || {
        ...(DEFAULT_LINK_PROPS as LinkProps),
        domain: primaryDomain,
        key: "",
        url: "",
      },
  );

  const { domain, key, url, password, proxy } = data;

  const [debouncedKey] = useDebounce(key, 500);
  useEffect(() => {
    /**
     * Only check if key exists if:
     * - modal is open
     * - key is not empty
     * - key is not the same as the original key
     **/
    if (
      showAddEditLinkModal &&
      debouncedKey.length > 0 &&
      debouncedKey.toLowerCase() !== props?.key.toLowerCase()
    ) {
      fetch(
        `/api/links/exists?domain=${domain}&key=${debouncedKey}&projectSlug=${slug}`,
      ).then(async (res) => {
        if (res.status === 200) {
          const exists = await res.json();
          setKeyError(
            exists ? "Duplicate key: This short link already exists." : null,
          );
        }
      });
    }
  }, [debouncedKey, domain]);

  const generateRandomKey = useCallback(async () => {
    setKeyError(null);
    setGeneratingKey(true);
    const res = await fetch(
      `/api/links/random?domain=${domain}&projectSlug=${slug}`,
    );
    const key = await res.json();
    setData((prev) => ({ ...prev, key }));
    setGeneratingKey(false);
  }, [domain, slug]);

  useEffect(() => {
    // when someone pastes a URL
    if (showAddEditLinkModal && url.length > 0) {
      // if it's a new link and there are matching default domains, set it as the domain
      if (!props && defaultDomains) {
        const urlDomain = getDomainWithoutWWW(url) || "";
        const defaultDomain = defaultDomains.find(({ allowedHostnames }) =>
          allowedHostnames.includes(urlDomain),
        );
        if (defaultDomain) {
          setData((prev) => ({ ...prev, domain: defaultDomain.slug }));
        }
      }

      // if there's no key, generate a random key
      if (!key) {
        generateRandomKey();
      }
    }
  }, [showAddEditLinkModal, url]);

  const [generatingMetatags, setGeneratingMetatags] = useState(
    props ? true : false,
  );
  const [debouncedUrl] = useDebounce(getUrlWithoutUTMParams(url), 500);
  useEffect(() => {
    // if there's a password, no need to generate metatags
    if (password) {
      setGeneratingMetatags(false);
      setData((prev) => ({
        ...prev,
        title: "Password Required",
        description:
          "This link is password protected. Please enter the password to view it.",
        image: "/_static/password-protected.png",
      }));
      return;
    }
    /**
     * Only generate metatags if:
     * - modal is open
     * - custom OG proxy is not enabled
     * - url is not empty
     **/
    if (showAddEditLinkModal && !proxy && debouncedUrl.length > 0) {
      setData((prev) => ({
        ...prev,
        title: null,
        description: null,
        image: null,
      }));
      try {
        // if url is valid, continue to generate metatags, else return null
        new URL(debouncedUrl);
        setGeneratingMetatags(true);
        fetch(`/api/metatags?url=${debouncedUrl}`).then(async (res) => {
          if (res.status === 200) {
            const results = await res.json();
            setData((prev) => ({
              ...prev,
              ...{
                title: truncate(results.title, 120),
                description: truncate(results.description, 240),
                image: results.image,
              },
            }));
          }
          // set timeout to prevent flickering
          setTimeout(() => setGeneratingMetatags(false), 200);
        });
      } catch (e) {
        console.log("not a valid url");
      }
    } else {
      setGeneratingMetatags(false);
    }
  }, [debouncedUrl, password, showAddEditLinkModal, proxy]);

  const logo = useMemo(() => {
    // if the link is password protected, or if it's a new link and there's no URL yet, return the default Dub logo
    // otherwise, get the favicon of the URL
    const url = password || !debouncedUrl ? null : debouncedUrl || props?.url;

    return url ? (
      <BlurImage
        src={`${GOOGLE_FAVICON_URL}${getApexDomain(url)}`}
        alt="Logo"
        className="h-10 w-10 rounded-full"
        width={20}
        height={20}
      />
    ) : (
      <Logo />
    );
  }, [password, debouncedUrl, props]);

  const endpoint = useMemo(() => {
    if (props?.key) {
      return {
        method: "PUT",
        url: `/api/links/${props.id}?projectSlug=${slug}`,
      };
    } else {
      return {
        method: "POST",
        url: `/api/links?projectSlug=${slug}`,
      };
    }
  }, [props, slug, domain]);

  const [atBottom, setAtBottom] = useState(false);
  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
    if (Math.abs(scrollHeight - scrollTop - clientHeight) < 5) {
      setAtBottom(true);
    } else {
      setAtBottom(false);
    }
  }, []);

  const saveDisabled = useMemo(() => {
    /* 
      Disable save if:
      - modal is not open
      - saving is in progress
      - key is invalid
      - url is invalid
      - metatags is being generated
      - for an existing link, there's no changes
    */
    if (
      !showAddEditLinkModal ||
      saving ||
      keyError ||
      urlError ||
      (props &&
        Object.entries(props).every(([key, value]) => {
          // If the key is "title" or "description" and proxy is not enabled, return true (skip the check)
          if (
            (key === "title" || key === "description" || key === "image") &&
            !proxy
          ) {
            return true;
          } else if (key === "geo") {
            const equalGeo = deepEqual(props.geo as object, data.geo as object);
            return equalGeo;
          }
          // Otherwise, check for discrepancy in the current key-value pair
          return data[key] === value;
        }))
    ) {
      return true;
    } else {
      return false;
    }
  }, [showAddEditLinkModal, saving, keyError, urlError, props, data]);

  const randomIdx = Math.floor(Math.random() * 100);

  const [lockKey, setLockKey] = useState(true);

  const welcomeFlow = pathname === "/welcome";
  const keyRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (key && key.endsWith("-copy")) {
      keyRef.current?.select();
    }
  }, [key]);

  const { isMobile } = useMediaQuery();

  return (
    <Modal
      showModal={showAddEditLinkModal}
      setShowModal={setShowAddEditLinkModal}
      className="max-w-screen-lg"
      preventDefaultClose={homepageDemo ? false : true}
      {...(welcomeFlow && { onClose: () => router.back() })}
    >
      <div className="scrollbar-hide grid max-h-[90vh] w-full divide-x divide-gray-100 overflow-auto md:grid-cols-2 md:overflow-hidden">
        {!welcomeFlow && !homepageDemo && (
          <button
            onClick={() => setShowAddEditLinkModal(false)}
            className="group absolute right-0 top-0 z-20 m-3 hidden rounded-full p-2 text-gray-500 transition-all duration-75 hover:bg-gray-100 focus:outline-none active:bg-gray-200 md:block"
          >
            <X className="h-5 w-5" />
          </button>
        )}

        <div
          className="scrollbar-hide rounded-l-2xl md:max-h-[90vh] md:overflow-auto"
          onScroll={handleScroll}
        >
          <div className="z-10 flex flex-col items-center justify-center space-y-3 border-b border-gray-200 bg-white px-4 pb-8 pt-8 transition-all md:sticky md:top-0 md:px-16">
            {logo}
            <h3 className="max-w-sm truncate text-lg font-medium">
              {props
                ? `Edit ${linkConstructor({
                    key: props.key,
                    domain: props.domain
                      ? punycode.toUnicode(props.domain)
                      : undefined,
                    pretty: true,
                  })}`
                : "Create a new link"}
            </h3>
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setSaving(true);
              // @ts-ignore – exclude the extra `user` attribute from `data` object before sending to API
              const { user, ...rest } = data;
              fetch(endpoint.url, {
                method: endpoint.method,
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(rest),
              }).then(async (res) => {
                if (res.status === 200) {
                  await mutate(
                    (key) =>
                      typeof key === "string" && key.startsWith("/api/links"),
                    undefined,
                    { revalidate: true },
                  );
                  // for welcome page, redirect to links page after adding a link
                  if (pathname === "/welcome") {
                    router.push("/links");
                    setShowAddEditLinkModal(false);
                  }
                  // copy shortlink to clipboard when adding a new link
                  if (!props) {
                    await navigator.clipboard.writeText(
                      linkConstructor({
                        // remove leading and trailing slashes
                        key: data.key.replace(/^\/+|\/+$/g, ""),
                        domain,
                      }),
                    );
                    toast.success("Copied shortlink to clipboard!");
                  } else {
                    toast.success("Successfully updated shortlink!");
                  }
                  setShowAddEditLinkModal(false);
                } else {
                  const error = await res.text();
                  if (error) {
                    toast.error(error);
                    if (error.toLowerCase().includes("key")) {
                      setKeyError(error);
                    } else if (error.toLowerCase().includes("url")) {
                      setUrlError(error);
                    }
                  } else {
                    toast.error(await res.text());
                  }
                }
                setSaving(false);
              });
            }}
            className="grid gap-6 bg-gray-50 pt-8"
          >
            <div className="grid gap-6 px-4 md:px-16">
              <div>
                <div className="flex items-center justify-between">
                  <label
                    htmlFor={`url-${randomIdx}`}
                    className="block text-sm font-medium text-gray-700"
                  >
                    Destination URL
                  </label>
                  {urlError && (
                    <p className="text-sm text-red-600" id="key-error">
                      Invalid url.
                    </p>
                  )}
                </div>
                <div className="relative mt-1 flex rounded-md shadow-sm">
                  <input
                    name="url"
                    id={`url-${randomIdx}`}
                    type="url"
                    required
                    placeholder={
                      domains?.find(({ slug }) => slug === domain)
                        ?.placeholder ||
                      "https://dub.co/help/article/what-is-dub"
                    }
                    value={url}
                    autoFocus={!key && !isMobile}
                    autoComplete="off"
                    onChange={(e) => {
                      setUrlError(null);
                      setData({ ...data, url: e.target.value });
                    }}
                    className={`${
                      urlError
                        ? "border-red-300 pr-10 text-red-900 placeholder-red-300 focus:border-red-500 focus:ring-red-500"
                        : "border-gray-300 text-gray-900 placeholder-gray-300 focus:border-gray-500 focus:ring-gray-500"
                    } block w-full rounded-md focus:outline-none sm:text-sm`}
                    aria-invalid="true"
                  />
                  {urlError && (
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                      <AlertCircleFill
                        className="h-5 w-5 text-red-500"
                        aria-hidden="true"
                      />
                    </div>
                  )}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <label
                    htmlFor={`key-${randomIdx}`}
                    className="block text-sm font-medium text-gray-700"
                  >
                    Short Link
                  </label>
                  {props && lockKey ? (
                    <button
                      className="flex items-center space-x-2 text-sm text-gray-500 transition-all duration-75 hover:text-black active:scale-95"
                      type="button"
                      onClick={() => {
                        window.confirm(
                          "Editing an existing short link will result in broken links and reset its analytics. Are you sure you want to continue?",
                        ) && setLockKey(false);
                      }}
                    >
                      <Lock className="h-3 w-3" />
                      <p>Unlock</p>
                    </button>
                  ) : (
                    <button
                      className="flex items-center space-x-2 text-sm text-gray-500 transition-all duration-75 hover:text-black active:scale-95"
                      onClick={generateRandomKey}
                      disabled={generatingKey}
                      type="button"
                    >
                      {generatingKey ? (
                        <LoadingCircle />
                      ) : (
                        <Random className="h-3 w-3" />
                      )}
                      <p>{generatingKey ? "Generating" : "Randomize"}</p>
                    </button>
                  )}
                </div>
                <div className="relative mt-1 flex rounded-md shadow-sm">
                  <select
                    disabled={props && lockKey}
                    value={domain}
                    onChange={(e) => {
                      setData({ ...data, domain: e.target.value });
                    }}
                    className={`${
                      props && lockKey ? "cursor-not-allowed" : ""
                    } w-40 rounded-l-md border border-r-0 border-gray-300 bg-gray-50 px-5 text-sm text-gray-500 focus:border-gray-300 focus:outline-none focus:ring-0`}
                  >
                    {domains?.map(({ slug }) => (
                      <option key={slug} value={slug}>
                        {punycode.toUnicode(slug || "")}
                      </option>
                    ))}
                  </select>
                  <input
                    ref={keyRef}
                    type="text"
                    name="key"
                    id={`key-${randomIdx}`}
                    required
                    pattern="[\p{L}\p{N}\p{Pd}\/]+"
                    onInvalid={(e) => {
                      e.currentTarget.setCustomValidity(
                        "Only letters, numbers, '-', and '/' are allowed.",
                      );
                    }}
                    disabled={props && lockKey}
                    autoComplete="off"
                    className={cn(
                      "block w-full rounded-r-md border-gray-300 text-gray-900 placeholder-gray-300 focus:border-gray-500 focus:outline-none focus:ring-gray-500 sm:text-sm",
                      {
                        "border-red-300 pr-10 text-red-900 placeholder-red-300 focus:border-red-500 focus:ring-red-500":
                          keyError,
                        "cursor-not-allowed border border-gray-300 bg-gray-100 text-gray-500":
                          props && lockKey,
                      },
                    )}
                    placeholder="github"
                    value={key}
                    onChange={(e) => {
                      setKeyError(null);
                      e.currentTarget.setCustomValidity("");
                      setData({ ...data, key: e.target.value });
                    }}
                    aria-invalid="true"
                    aria-describedby="key-error"
                  />
                  {keyError && (
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                      <AlertCircleFill
                        className="h-5 w-5 text-red-500"
                        aria-hidden="true"
                      />
                    </div>
                  )}
                </div>
                {keyError && (
                  <p className="mt-2 text-sm text-red-600" id="key-error">
                    {keyError}
                  </p>
                )}
              </div>
            </div>

            {/* Divider */}
            <div className="relative pb-3 pt-5">
              <div
                className="absolute inset-0 flex items-center px-4 md:px-16"
                aria-hidden="true"
              >
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-gray-50 px-2 text-sm text-gray-500">
                  Optional
                </span>
              </div>
            </div>

            <div className="grid gap-5 px-4 md:px-16">
              {slug && <TagsSection {...{ props, data, setData }} />}
              <CommentsSection {...{ props, data, setData }} />
              <UTMSection {...{ props, data, setData }} />
              <OGSection
                {...{ props, data, setData }}
                generatingMetatags={generatingMetatags}
              />
              <RewriteSection {...{ data, setData }} />
              <PasswordSection {...{ props, data, setData }} />
              <ExpirationSection {...{ props, data, setData }} />
              <IOSSection {...{ props, data, setData }} />
              <AndroidSection {...{ props, data, setData }} />
              <GeoSection {...{ props, data, setData }} />
            </div>

            <div
              className={`${
                atBottom ? "" : "md:shadow-[0_-20px_30px_-10px_rgba(0,0,0,0.1)]"
              } z-10 bg-gray-50 px-4 py-8 transition-all md:sticky  md:bottom-0 md:px-16`}
            >
              {homepageDemo ? (
                <Button
                  disabledTooltip="This is a demo link. You can't edit it."
                  text="Save changes"
                />
              ) : (
                <Button
                  disabled={saveDisabled}
                  loading={saving}
                  text={props ? "Save changes" : "Create link"}
                />
              )}
            </div>
          </form>
        </div>
        <div className="scrollbar-hide rounded-r-2xl md:max-h-[90vh] md:overflow-auto">
          <Preview data={data} generatingMetatags={generatingMetatags} />
        </div>
      </div>
    </Modal>
  );
}

function AddEditLinkButton({
  setShowAddEditLinkModal,
}: {
  setShowAddEditLinkModal: Dispatch<SetStateAction<boolean>>;
}) {
  const { plan, exceededLinks } = useProject();
  const { queryParams } = useRouterStuff();

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const existingModalBackdrop = document.getElementById("modal-backdrop");
    // only open modal with keyboard shortcut if:
    // - c is pressed
    // - user is not pressing cmd/ctrl + c
    // - user is not typing in an input or textarea
    // - there is no existing modal backdrop (i.e. no other modal is open)
    // - project has not exceeded links limit
    if (
      e.key === "c" &&
      !e.metaKey &&
      !e.ctrlKey &&
      target.tagName !== "INPUT" &&
      target.tagName !== "TEXTAREA" &&
      !existingModalBackdrop &&
      !exceededLinks
    ) {
      e.preventDefault(); // or else it'll show up in the input field since that's getting auto-selected
      setShowAddEditLinkModal(true);
    }
  }, []);

  // listen to paste event, and if it's a URL, open the modal and input the URL
  const handlePaste = (e: ClipboardEvent) => {
    const pastedContent = e.clipboardData?.getData("text");
    const target = e.target as HTMLElement;
    const existingModalBackdrop = document.getElementById("modal-backdrop");

    // make sure:
    // - pasted content is a valid URL
    // - user is not typing in an input or textarea
    // - there is no existing modal backdrop (i.e. no other modal is open)
    // - project has not exceeded links limit
    if (
      pastedContent &&
      isValidUrl(pastedContent) &&
      target.tagName !== "INPUT" &&
      target.tagName !== "TEXTAREA" &&
      !existingModalBackdrop &&
      !exceededLinks
    ) {
      setShowAddEditLinkModal(true);
    }
  };

  useEffect(() => {
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("paste", handlePaste);
    return () => {
      document.removeEventListener("keydown", onKeyDown),
        document.removeEventListener("paste", handlePaste);
    };
  }, [onKeyDown]);

  return (
    <Button
      text="Create link"
      shortcut="C"
      disabledTooltip={
        exceededLinks ? (
          <TooltipContent
            title="Your project has exceeded its monthly links limit. We're still collecting data on your existing links, but you need to upgrade to add more links."
            cta={`Upgrade to ${plan === "free" ? "Pro" : "Business"}`}
            onClick={() => {
              queryParams({
                set: {
                  upgrade: plan === "free" ? "pro" : "business",
                },
              });
            }}
          />
        ) : undefined
      }
      onClick={() => setShowAddEditLinkModal(true)}
    />
  );
}

export function useAddEditLinkModal({
  props,
  duplicateProps,
  homepageDemo,
}: {
  props?: LinkProps;
  duplicateProps?: LinkProps;
  homepageDemo?: boolean;
} = {}) {
  const [showAddEditLinkModal, setShowAddEditLinkModal] = useState(false);

  const AddEditLinkModalCallback = useCallback(() => {
    return (
      <AddEditLinkModal
        showAddEditLinkModal={showAddEditLinkModal}
        setShowAddEditLinkModal={setShowAddEditLinkModal}
        props={props}
        duplicateProps={duplicateProps}
        homepageDemo={homepageDemo}
      />
    );
  }, [showAddEditLinkModal, setShowAddEditLinkModal]);

  const AddEditLinkButtonCallback = useCallback(() => {
    return (
      <AddEditLinkButton setShowAddEditLinkModal={setShowAddEditLinkModal} />
    );
  }, [setShowAddEditLinkModal]);

  return useMemo(
    () => ({
      showAddEditLinkModal,
      setShowAddEditLinkModal,
      AddEditLinkModal: AddEditLinkModalCallback,
      AddEditLinkButton: AddEditLinkButtonCallback,
    }),
    [
      showAddEditLinkModal,
      setShowAddEditLinkModal,
      AddEditLinkModalCallback,
      AddEditLinkButtonCallback,
    ],
  );
}
