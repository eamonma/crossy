// The signed-in shell: one sidebar around one content frame, the claude.ai shape on the v2
// language. Pinned on top: the wordmark (home), New game (the one accent action), and
// Puzzles (the library). The middle is the recent-games list straight off GET /games, one
// quiet line per game, newest first. A finished game (completedAt present, read from the
// session-owned game_state under the API's read grant, DESIGN.md section 9) wears a small,
// muted check ahead of its name; ongoing games carry nothing, so the list stays calm. The
// user card holds the bottom.
//
// Collapse model: shadcn's Sidebar gives the icon rail, cmd+B, and the mobile Sheet; this
// shell controls `open`. Default is per surface (expanded at home, collapsed in a game, so
// the board keeps the room), but an explicit toggle wins and persists in localStorage next
// to the theme choice. On phones there is no rail: home surfaces get a slim header that
// opens the sheet, and the game stays full-bleed with its own back affordance.
//
// Motion: an explicit toggle animates, everything else snaps. The shell arms the CSS
// choreography (styles.css, "Sidebar collapse/expand choreography") by setting
// data-animate on the provider inside the toggle handler, and drops it during render
// whenever the route changes, so a route-driven default flip (home -> game) and first
// paint land instantly. The choreography itself: leaving content dissolves at once, the
// rail and its movers glide on one clock, arriving content reveals once there is room.
// The brand block and user card below are shaped for that: the mark, the trigger, and
// the avatar are single persistent elements (focus survives a toggle), and wide content
// is pinned to the expanded width so nothing reflows or re-truncates mid-flight.
import { useCallback, useMemo, useState } from "react";
import {
  CheckIcon,
  DesktopIcon,
  ExitIcon,
  FileTextIcon,
  GearIcon,
  HamburgerMenuIcon,
  MoonIcon,
  PlusIcon,
  SunIcon,
} from "@radix-ui/react-icons";
import type { Identity, IdentitySession } from "../identity";
import type { Navigate, Route } from "../nav";
import {
  createHref,
  gameHref,
  homeHref,
  puzzlesHref,
  settingsHref,
  togglePartyHref,
} from "../nav";
import { Divider, Logo } from "./primitives";
import { useTheme } from "./useTheme";
import type { Resource } from "./useResource";
import { compactTime, gameTitle, isCompleted } from "./homeData";
import type { GameSummary } from "./homeData";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

/** Sidebar preference, stored only on an explicit toggle (localStorage, like the theme). */
const SIDEBAR_PREF_KEY = "crossy-sidebar";

type SidebarPref = "expanded" | "collapsed";

function storedPref(): SidebarPref | null {
  try {
    const v = window.localStorage.getItem(SIDEBAR_PREF_KEY);
    return v === "expanded" || v === "collapsed" ? v : null;
  } catch {
    return null;
  }
}

export function AppShell({
  route,
  params,
  navigate,
  identity,
  games,
  reloadGames,
  children,
}: {
  route: Route;
  params: URLSearchParams;
  navigate: Navigate;
  identity: Identity;
  /** The recents read (GET /games) is owned by the Router and shared with the home panel. */
  games: Resource<GameSummary[]>;
  reloadGames: () => void;
  children: React.ReactNode;
}) {
  // The user's explicit toggle (any run) wins everywhere; without one, the surface decides:
  // expanded at home so the recents read, collapsed in a game so the board keeps the room.
  const [pref, setPref] = useState<SidebarPref | null>(() => storedPref());
  const open = pref !== null ? pref === "expanded" : route.kind !== "game";

  // Animate only the explicit toggle. onOpenChange fires for exactly those (trigger,
  // cmd+B); a route-driven default flip changes `open` without it. Dropping the flag
  // during the same render that sees a new route (the render-phase adjustment pattern)
  // guarantees the disarm and the width change reach the DOM in one commit, so the
  // browser never paints an armed transition around a navigation.
  const [animate, setAnimate] = useState(false);
  const [lastRouteKind, setLastRouteKind] = useState(route.kind);
  if (route.kind !== lastRouteKind) {
    setLastRouteKind(route.kind);
    if (animate) setAnimate(false);
  }

  const onOpenChange = useCallback((next: boolean) => {
    setAnimate(true);
    const value: SidebarPref = next ? "expanded" : "collapsed";
    setPref(value);
    try {
      window.localStorage.setItem(SIDEBAR_PREF_KEY, value);
    } catch {
      // Private mode or blocked storage: keep the in-memory choice, skip persistence.
    }
  }, []);

  const activeGameId = route.kind === "game" ? route.gameId : null;

  return (
    <SidebarProvider
      open={open}
      onOpenChange={onOpenChange}
      data-animate={animate ? "true" : undefined}
      className="h-dvh overflow-hidden"
    >
      <TooltipProvider delayDuration={150}>
        <CrossySidebar
          route={route}
          params={params}
          navigate={navigate}
          session={identity.getSession()}
          games={games}
          onReloadGames={reloadGames}
          activeGameId={activeGameId}
          onSignOut={() => void identity.signOut()}
        />
        <SidebarInset className="h-dvh min-h-0 overflow-hidden">
          {route.kind !== "game" && (
            <MobileHeader onHome={() => navigate(homeHref(params))} />
          )}
          <div className="min-h-0 min-w-0 flex-1">{children}</div>
        </SidebarInset>
      </TooltipProvider>
    </SidebarProvider>
  );
}

/** The phone header for home surfaces: wordmark plus the sheet trigger. The game screen
 * deliberately has no counterpart; it stays full-bleed and its toolbar leads back home. */
function MobileHeader({ onHome }: { onHome: () => void }) {
  const { toggleSidebar } = useSidebar();
  return (
    <div className="px-4 pt-4 md:hidden">
      <div className="flex h-12 items-center justify-between rounded-3 border border-border bg-panel px-3">
        <button
          type="button"
          onClick={onHome}
          className="inline-flex items-center rounded-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          aria-label="Crossy home"
        >
          <Logo />
        </button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleSidebar}
          aria-label="Open menu"
        >
          <HamburgerMenuIcon />
        </Button>
      </div>
    </div>
  );
}

function CrossySidebar({
  route,
  params,
  navigate,
  session,
  games,
  onReloadGames,
  activeGameId,
  onSignOut,
}: {
  route: Route;
  params: URLSearchParams;
  navigate: Navigate;
  session: IdentitySession | null;
  games: Resource<GameSummary[]>;
  onReloadGames: () => void;
  activeGameId: string | null;
  onSignOut: () => void;
}) {
  const { setOpenMobile } = useSidebar();
  const go = useCallback(
    (to: string) => {
      setOpenMobile(false);
      navigate(to);
    },
    [setOpenMobile, navigate],
  );
  const now = useMemo(() => new Date(), []);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-3 p-3 group-data-[collapsible=icon]:px-1">
        {/* The brand block: the mark, with the wordmark tucking and dissolving as the rail
            narrows. The mark is one element across both states, so keyboard focus survives
            a toggle. The sidebar toggle itself lives in the content panel (never the rail),
            so nothing reflows under the cursor when the rail collapses. Mark 24, so the
            block is 40 tall (translate-y centers it) in both states. */}
        <div className="relative h-[40px]">
          <button
            type="button"
            onClick={() => go(homeHref(params))}
            className="sidebar-glide absolute top-0 left-0 inline-flex translate-x-1 translate-y-2 items-center rounded-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring group-data-[collapsible=icon]:translate-x-2"
            aria-label="Crossy home"
          >
            <Logo withName={false} />
            {/* The wordmark half of the Logo lockup (primitives.tsx), split out so it can
                tuck and dissolve while the mark holds still. Type recipe kept in sync
                with Logo: display serif, semibold, 18px (24 * 0.75), 6px gap. */}
            <span className="sidebar-dissolve sidebar-glide ml-1.5 max-w-[64px] overflow-hidden font-display text-[18px] leading-none font-semibold tracking-[-0.00625em] whitespace-nowrap group-data-[collapsible=icon]:ml-0 group-data-[collapsible=icon]:max-w-0 group-data-[collapsible=icon]:opacity-0">
              Crossy
            </span>
          </button>
        </div>
        <SidebarMenu className="gap-1">
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="New game"
              onClick={() => go(createHref(params))}
              isActive={route.kind === "create"}
              aria-current={route.kind === "create" ? "page" : undefined}
              className="text-gold-11 hover:bg-gold-3 hover:text-gold-12 active:bg-gold-3 active:text-gold-12"
            >
              <PlusIcon className="sidebar-glide group-data-[collapsible=icon]:translate-x-1" />
              <span>New game</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Puzzles"
              onClick={() => go(puzzlesHref(params))}
              isActive={route.kind === "puzzles"}
              aria-current={route.kind === "puzzles" ? "page" : undefined}
              className="text-text-muted"
            >
              <FileTextIcon className="sidebar-glide group-data-[collapsible=icon]:translate-x-1" />
              <span>Puzzles</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      {/* The dashed rule only earns its place by separating the nav from the recents below
          it; at rail width the recents dissolve, so the rule dissolves with them (same clock)
          and returns on expand, rather than hanging under the icons with nothing to divide. */}
      <div className="sidebar-dissolve px-3 group-data-[collapsible=icon]:invisible group-data-[collapsible=icon]:opacity-0">
        <Divider />
      </div>

      {/* Recents make no sense at rail width, so the group dissolves with the rail (the
          content block itself keeps its flex-1 so the user card stays pinned to the foot);
          the icons above stay as the persistent affordances. The group is pinned to the
          expanded width (not w-full) and clipped by SidebarContent, so its rows never
          reflow or re-truncate while the rail moves; visibility rides the fade so the
          rows leave the tab order exactly as `hidden` had them. */}
      <SidebarContent>
        <SidebarGroup className="sidebar-dissolve w-(--sidebar-width) px-3 py-2 group-data-[collapsible=icon]:invisible group-data-[collapsible=icon]:opacity-0">
          <SidebarGroupContent>
            <RecentGames
              games={games}
              onReload={onReloadGames}
              activeGameId={activeGameId}
              onOpen={(gameId) => go(gameHref(gameId, params))}
              now={now}
            />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* overflow-hidden clips the pinned-width user card at the rail edge mid-flight. */}
      <SidebarFooter className="overflow-hidden p-3 group-data-[collapsible=icon]:px-1">
        <UserCard
          session={session}
          onSignOut={onSignOut}
          onSettings={() => go(settingsHref(params))}
          // Party mode is a game-only presentation, so the entry only shows on a game route;
          // it opens the projector screen (?party=1), where a plain "Leave party mode" control
          // returns here. The URL flag keeps working exactly as before.
          onEnterParty={
            route.kind === "game"
              ? () => go(togglePartyHref(route.gameId, params, true))
              : undefined
          }
        />
      </SidebarFooter>
    </Sidebar>
  );
}

function RecentGames({
  games,
  onReload,
  activeGameId,
  onOpen,
  now,
}: {
  games: Resource<GameSummary[]>;
  onReload: () => void;
  activeGameId: string | null;
  onOpen: (gameId: string) => void;
  now: Date;
}) {
  if (games.phase === "loading") {
    return (
      <SidebarMenu className="gap-0.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <SidebarMenuItem key={i}>
            <SidebarMenuSkeleton />
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    );
  }
  if (games.phase === "error") {
    return (
      <div className="flex flex-col items-start gap-1.5 px-2 py-1.5">
        <span className="text-1 text-text-subtle">
          Couldn&apos;t load your games.
        </span>
        <button
          type="button"
          onClick={onReload}
          className="text-1 font-medium text-text-muted underline decoration-dashed underline-offset-4 hover:text-text"
        >
          Try again
        </button>
      </div>
    );
  }
  if (games.data.length === 0) {
    return (
      <p className="m-0 px-2 py-1.5 text-1 text-text-subtle">
        Games you start or join will show up here.
      </p>
    );
  }
  return (
    <SidebarMenu className="gap-0.5">
      {games.data.map((g) => {
        const title = gameTitle(g, now);
        const active = g.gameId === activeGameId;
        const done = isCompleted(g);
        return (
          <SidebarMenuItem key={g.gameId}>
            <SidebarMenuButton
              onClick={() => onOpen(g.gameId)}
              isActive={active}
              aria-current={active ? "page" : undefined}
              title={done ? `${title} (completed)` : title}
              className="font-normal text-text-muted data-active:font-normal"
            >
              {done && (
                <CheckIcon
                  aria-label="Completed"
                  className="size-3.5 shrink-0 text-text-subtle"
                />
              )}
              <span className="min-w-0 flex-1 truncate">{title}</span>
              <span className="shrink-0 font-mono text-1 tabular-nums text-text-subtle">
                {compactTime(g.createdAt, now)}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

/** The account menu items, shared by the full card and the rail's avatar-only trigger. When a
 * game is open, `onEnterParty` adds a plain entry into party mode so it no longer takes a
 * hand-typed ?party in the URL. */
function AccountMenu({
  onSignOut,
  onSettings,
  onEnterParty,
}: {
  onSignOut: () => void;
  onSettings: () => void;
  onEnterParty?: (() => void) | undefined;
}) {
  const { theme, toggle } = useTheme();
  return (
    <>
      <DropdownMenuLabel className="text-text-muted">Account</DropdownMenuLabel>
      <DropdownMenuItem onClick={onSettings}>
        <GearIcon />
        Settings
      </DropdownMenuItem>
      <DropdownMenuItem onClick={toggle}>
        {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        {theme === "dark" ? "Light theme" : "Dark theme"}
      </DropdownMenuItem>
      {onEnterParty !== undefined && (
        <DropdownMenuItem onClick={onEnterParty}>
          <DesktopIcon />
          Party mode
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={onSignOut}>
        <ExitIcon />
        Sign out
      </DropdownMenuItem>
    </>
  );
}

/** The v2 user card pinned at the sidebar's foot; at rail width it condenses to the avatar,
 * which becomes the menu trigger itself. The two faces are stacked (the chip overlays the
 * card's bottom-left corner) and crossfade on the dissolve/reveal clocks; the card is
 * pinned to its expanded width so its text never reflows while the rail moves, and the
 * footer clips it at the rail edge. */
function UserCard({
  session,
  onSignOut,
  onSettings,
  onEnterParty,
}: {
  session: IdentitySession | null;
  onSignOut: () => void;
  onSettings: () => void;
  onEnterParty?: (() => void) | undefined;
}) {
  const name = session?.displayName ?? "You";
  const initial = (session?.displayName ?? "Y").slice(0, 1).toUpperCase();
  const avatar = (
    <Avatar size="sm">
      <AvatarFallback className="bg-gold-4 text-gold-11">
        {initial}
      </AvatarFallback>
    </Avatar>
  );
  return (
    <div className="relative">
      {/* Pinned width: the expanded footer gutter is p-3, so the card face is the
          sidebar width minus 24px in every state. */}
      <div className="sidebar-dissolve flex w-[calc(var(--sidebar-width)-24px)] items-center justify-between gap-2 rounded-4 border border-border bg-panel p-3 shadow-sm group-data-[collapsible=icon]:invisible group-data-[collapsible=icon]:opacity-0">
        <div className="flex min-w-0 items-center gap-2">
          {avatar}
          <div className="min-w-0 leading-tight">
            <div className="truncate text-2 font-semibold text-text">
              {name}
            </div>
            {session?.isAnonymous === true && (
              <div className="text-1 text-text-subtle">Guest</div>
            )}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Account">
              <HamburgerMenuIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <AccountMenu
              onSignOut={onSignOut}
              onSettings={onSettings}
              onEnterParty={onEnterParty}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {/* The rail chip: bottom-anchored over the card so its resting spot matches the
          old collapsed layout, centered in the rail's 40px gutter (48 minus px-1). */}
      <div className="sidebar-reveal invisible absolute bottom-0 left-0 flex w-[calc(var(--sidebar-width-icon)-8px)] justify-center opacity-0 group-data-[collapsible=icon]:visible group-data-[collapsible=icon]:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Account"
              className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              {avatar}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="w-52">
            <AccountMenu
              onSignOut={onSignOut}
              onSettings={onSettings}
              onEnterParty={onEnterParty}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
