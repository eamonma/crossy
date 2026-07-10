// The signed-in shell: one sidebar around one content frame, the claude.ai shape on the v2
// language. Pinned on top: the wordmark (home), New game (the one accent action), and
// Puzzles (the library). The middle is the recent-games list straight off GET /games, one
// quiet line per game, newest first; there is deliberately no status dot, because lifecycle
// is session-owned and the API cannot report it (DESIGN.md section 9). The user card holds
// the bottom.
//
// Collapse model: shadcn's Sidebar gives the icon rail, cmd+B, and the mobile Sheet; this
// shell controls `open`. Default is per surface (expanded at home, collapsed in a game, so
// the board keeps the room), but an explicit toggle wins and persists in localStorage next
// to the theme choice. On phones there is no rail: home surfaces get a slim header that
// opens the sheet, and the game stays full-bleed with its own back affordance.
import { useCallback, useMemo, useState } from "react";
import {
  ExitIcon,
  FileTextIcon,
  HamburgerMenuIcon,
  MoonIcon,
  PlusIcon,
  SunIcon,
} from "@radix-ui/react-icons";
import type { Identity, IdentitySession } from "../identity";
import type { Navigate, Route } from "../nav";
import { createHref, gameHref, homeHref, puzzlesHref } from "../nav";
import { Divider, Logo } from "./primitives";
import { useTheme } from "./useTheme";
import type { Resource } from "./useResource";
import { compactTime, gameTitle } from "./homeData";
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
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
  SidebarTrigger,
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
  const onOpenChange = useCallback((next: boolean) => {
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
        <div className="flex items-center justify-between pl-1 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:gap-2 group-data-[collapsible=icon]:pl-0">
          <button
            type="button"
            onClick={() => go(homeHref(params))}
            className="inline-flex items-center rounded-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            aria-label="Crossy home"
          >
            <span className="group-data-[collapsible=icon]:hidden">
              <Logo />
            </span>
            <span className="hidden group-data-[collapsible=icon]:inline-flex">
              <Logo withName={false} />
            </span>
          </button>
          <SidebarTrigger className="hidden text-text-subtle hover:text-text md:inline-flex" />
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
              <PlusIcon />
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
              <FileTextIcon />
              <span>Puzzles</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <div className="px-3 group-data-[collapsible=icon]:px-1">
        <Divider />
      </div>

      {/* Recents make no sense at rail width, so the group folds away with the rail (the
          content block itself keeps its flex-1 so the user card stays pinned to the foot);
          the icons above stay as the persistent affordances. */}
      <SidebarContent>
        <SidebarGroup className="px-3 py-2 group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>Recent</SidebarGroupLabel>
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

      <SidebarFooter className="p-3 group-data-[collapsible=icon]:px-1">
        <UserCard session={session} onSignOut={onSignOut} />
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
      <SidebarMenu>
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
    <SidebarMenu>
      {games.data.map((g) => {
        const title = gameTitle(g, now);
        const active = g.gameId === activeGameId;
        return (
          <SidebarMenuItem key={g.gameId}>
            <SidebarMenuButton
              onClick={() => onOpen(g.gameId)}
              isActive={active}
              aria-current={active ? "page" : undefined}
              title={title}
              className="font-normal text-text-muted data-active:font-normal"
            >
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

/** The account menu items, shared by the full card and the rail's avatar-only trigger. */
function AccountMenu({ onSignOut }: { onSignOut: () => void }) {
  const { theme, toggle } = useTheme();
  return (
    <>
      <DropdownMenuLabel className="text-text-muted">Account</DropdownMenuLabel>
      <DropdownMenuItem onClick={toggle}>
        {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        {theme === "dark" ? "Light theme" : "Dark theme"}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={onSignOut}>
        <ExitIcon />
        Sign out
      </DropdownMenuItem>
    </>
  );
}

/** The v2 user card pinned at the sidebar's foot; at rail width it condenses to the avatar,
 * which becomes the menu trigger itself. */
function UserCard({
  session,
  onSignOut,
}: {
  session: IdentitySession | null;
  onSignOut: () => void;
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
    <>
      <div className="flex items-center justify-between gap-2 rounded-4 border border-border bg-panel p-3 shadow-sm group-data-[collapsible=icon]:hidden">
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
            <AccountMenu onSignOut={onSignOut} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="hidden justify-center group-data-[collapsible=icon]:flex">
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
            <AccountMenu onSignOut={onSignOut} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}
