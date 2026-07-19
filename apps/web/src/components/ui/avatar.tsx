import * as React from "react";
import { Avatar as AvatarPrimitive } from "radix-ui";

import {
  hasAvatarLoadFailed,
  recordAvatarLoadFailure,
  subscribeAvatarLoadFailures,
} from "@/components/ui/avatar-load-failures";
import { cn } from "@/lib/utils";

function Avatar({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root> & {
  size?: "default" | "sm" | "lg";
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        // Sizes as rem literals (badge.tsx's lesson): the theme's Radix spacing steps
        // render size-8 at 48px and size-6 at 32px, so the stock shadcn scale quietly
        // outgrows every row calibrated for 32/24/40px avatars (the game toolbar's
        // 36px floor, its 8rem presence slot).
        "group/avatar relative flex size-[2rem] shrink-0 rounded-full select-none after:absolute after:inset-0 after:rounded-full after:border after:border-border after:mix-blend-darken data-[size=lg]:size-[2.5rem] data-[size=sm]:size-[1.5rem] dark:after:mix-blend-lighten",
        className,
      )}
      {...props}
    />
  );
}

function AvatarImage({
  className,
  src,
  onLoadingStatusChange,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  // Known-missing avatars stay missing for the whole session: server-resolved URLs
  // can be Gravatar d=404, PROTOCOL.md section 4 treats a load error as absence, and
  // Radix retries the load on every mount, so remounting rosters would re-fetch the
  // same 404 forever. On the first error the src is recorded in a shared negative
  // cache and every mounted avatar for it drops its image; the sibling
  // AvatarFallback at each call site already shows.
  const getSnapshot = () => typeof src === "string" && hasAvatarLoadFailed(src);
  const failed = React.useSyncExternalStore(
    subscribeAvatarLoadFailures,
    getSnapshot,
    // Server snapshot so the .tsx suites' react-dom/server renders don't throw.
    getSnapshot,
  );
  if (failed) return null;
  return (
    <AvatarPrimitive.Image
      src={src}
      onLoadingStatusChange={(status) => {
        if (status === "error" && typeof src === "string") {
          recordAvatarLoadFailure(src);
        }
        onLoadingStatusChange?.(status);
      }}
      data-slot="avatar-image"
      className={cn(
        // Radix only mounts this <img> once it has finished loading, so it never
        // occupies layout on its own: absolute + inset-0 lays it directly over the
        // fallback's footprint (Root is the reserved box) instead of appending a
        // flex sibling that could nudge the row. Zero reflow when the image resolves.
        "absolute inset-0 aspect-square size-full rounded-full object-cover",
        className,
      )}
      {...props}
    />
  );
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center rounded-full bg-muted text-2 text-muted-foreground group-data-[size=sm]/avatar:text-1",
        className,
      )}
      {...props}
    />
  );
}

function AvatarBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        "absolute right-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground bg-blend-color ring-2 ring-background select-none",
        "group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:[&>svg]:hidden",
        "group-data-[size=default]/avatar:size-2.5 group-data-[size=default]/avatar:[&>svg]:size-2",
        "group-data-[size=lg]/avatar:size-3 group-data-[size=lg]/avatar:[&>svg]:size-2",
        className,
      )}
      {...props}
    />
  );
}

function AvatarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        "group/avatar-group flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background",
        className,
      )}
      {...props}
    />
  );
}

function AvatarGroupCount({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group-count"
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-2 text-muted-foreground ring-2 ring-background group-has-data-[size=lg]/avatar-group:size-10 group-has-data-[size=sm]/avatar-group:size-6 [&>svg]:size-4 group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3",
        className,
      )}
      {...props}
    />
  );
}

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarBadge,
};
