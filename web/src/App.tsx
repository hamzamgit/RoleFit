import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Routes,
  Route,
  NavLink,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  Activity,
  BarChart3,
  Clock,
  Code,
  Cpu,
  Database,
  Download,
  Eye,
  FolderOpen,
  FileText,
  Globe,
  Heart,
  KeyRound,
  Menu,
  MessageSquare,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Puzzle,
  RotateCw,
  Settings,
  Shield,
  Sparkles,
  Star,
  Terminal,
  Users,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import {
  Sparkle as PhSparkle,
  IdentificationCard as PhIdentificationCard,
  Briefcase as PhBriefcase,
  Target as PhTarget,
  Kanban as PhKanban,
} from "@phosphor-icons/react";
import { Button } from "@nous-research/ui/ui/components/button";
import { SelectionSwitcher } from "@nous-research/ui/ui/components/selection-switcher";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { Typography } from "@nous-research/ui/ui/components/typography/index";
import { cn } from "@/lib/utils";
import { Backdrop } from "@/components/Backdrop";
import { SidebarFooter } from "@/components/SidebarFooter";
import { SidebarStatusStrip, gatewayLine } from "@/components/SidebarStatusStrip";
import { useBelowBreakpoint } from "@nous-research/ui/hooks/use-below-breakpoint";
import { useSidebarStatus } from "@/hooks/useSidebarStatus";
import { AuthWidget } from "@/components/AuthWidget";
import { PageHeaderProvider } from "@/contexts/PageHeaderProvider";
import { ProfileProvider } from "@/contexts/ProfileProvider";
import { ChatProvider } from "@/contexts/ChatProvider";
import { useProfileScope } from "@/contexts/useProfileScope";
import { ProfileSwitcher } from "@/components/ProfileSwitcher";
import { ProfileScopeBanner } from "@/components/ProfileScopeBanner";
import { useSystemActions } from "@/contexts/useSystemActions";
import type { SystemAction } from "@/contexts/system-actions-context";
import ConfigPage from "@/pages/ConfigPage";
import DocsPage from "@/pages/DocsPage";
import EnvPage from "@/pages/EnvPage";
import FilesPage from "@/pages/FilesPage";
import SessionsPage from "@/pages/SessionsPage";
import ApplicantsPage from "@/pages/ApplicantsPage";
import JobsPage from "@/pages/JobsPage";
import MatchesPage from "@/pages/MatchesPage";
import ApplicationsPage from "@/pages/ApplicationsPage";
import SetupChatPage from "@/pages/SetupChatPage";
import LogsPage from "@/pages/LogsPage";
import AnalyticsPage from "@/pages/AnalyticsPage";
import ModelsPage from "@/pages/ModelsPage";
import CronPage from "@/pages/CronPage";
import ProfilesPage from "@/pages/ProfilesPage";
import ProfileBuilderPage from "@/pages/ProfileBuilderPage";
import SkillsPage from "@/pages/SkillsPage";
import PluginsPage from "@/pages/PluginsPage";
import McpPage from "@/pages/McpPage";
import PairingPage from "@/pages/PairingPage";
import ChannelsPage from "@/pages/ChannelsPage";
import WebhooksPage from "@/pages/WebhooksPage";
import SystemPage from "@/pages/SystemPage";
import ChatPage from "@/pages/ChatPage";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { useI18n } from "@/i18n";
import type { Translations } from "@/i18n/types";
import { PluginPage, PluginSlot, usePlugins } from "@/plugins";
import type { PluginManifest } from "@/plugins";
import { useTheme } from "@/themes";
import { isDashboardEmbeddedChatEnabled } from "@/lib/dashboard-flags";
import { api } from "@/lib/api";
import type { StatusResponse } from "@/lib/api";

function RootRedirect() {
  return <Navigate to="/rolepilot" replace />;
}

function UnknownRouteFallback({ pluginsLoading }: { pluginsLoading: boolean }) {
  if (pluginsLoading) {
    // Render nothing during the plugin-load window — a spinner here would just flash.
    return null;
  }
  return <Navigate to="/rolepilot" replace />;
}

// Hidden from the RoleFit sidebar. The /chat route + persistent ChatPage
// host are untouched; this nav entry is just no longer surfaced. Kept
// (commented) rather than deleted so it's trivial to restore.
// const CHAT_NAV_ITEM: NavItem = {
//   path: "/chat",
//   labelKey: "chat",
//   label: "Chat",
//   icon: Terminal,
// };

/**
 * Built-in routes except /chat.  Chat is rendered persistently (outside
 * <Routes>) when embedded — see the persistent chat host block rendered
 * inline near the bottom of this file — so the PTY child, WebSocket,
 * and xterm instance survive when the user visits another tab and comes
 * back.  A `display:none` toggle hides the terminal without unmounting.
 * Routing still owns the URL so /chat deep-links, browser back/forward,
 * and nav highlight keep working.
 */
const BUILTIN_ROUTES_CORE: Record<string, ComponentType> = {
  "/": RootRedirect,
  "/applicants": ApplicantsPage,
  "/jobs": JobsPage,
  "/matches": MatchesPage,
  "/applications": ApplicationsPage,
  "/rolepilot": SetupChatPage,
  "/rolepilot/:sessionId": SetupChatPage,
  "/sessions": SessionsPage,
  "/files": FilesPage,
  "/analytics": AnalyticsPage,
  "/models": ModelsPage,
  "/logs": LogsPage,
  "/cron": CronPage,
  "/skills": SkillsPage,
  "/plugins": PluginsPage,
  "/mcp": McpPage,
  "/pairing": PairingPage,
  "/channels": ChannelsPage,
  "/webhooks": WebhooksPage,
  "/system": SystemPage,
  "/profiles": ProfilesPage,
  "/profiles/new": ProfileBuilderPage,
  "/config": ConfigPage,
  "/env": EnvPage,
  "/docs": DocsPage,
};

// Route placeholder for /chat.  The persistent ChatPage host (rendered
// outside <Routes> when embedded chat is on) paints on top; this empty
// element just claims the path so the `*` catch-all redirect doesn't
// fire when the user navigates to /chat.
function ChatRouteSink() {
  return null;
}

/**
 * RoleFit sidebar nav — ONLY the five product surfaces are shown:
 * Maestro, Applicants, Jobs, Matches, Applications.
 *
 * Every other Hermes tab (Chat, Sessions, Files, Models, Logs, Cron,
 * Skills, Plugins, MCP, Channels, Webhooks, Pairing, Profiles, Analytics,
 * Env, Config, Docs, System) is intentionally kept out of the visible nav
 * but is NOT deleted — its route stays registered in BUILTIN_ROUTES_CORE
 * and its page import is untouched, so deep-links still resolve. The hidden
 * entries are preserved below (commented) for reference / easy restore.
 */
const BUILTIN_NAV_REST: NavItem[] = [
  { path: "/rolepilot", label: "RolePilot", icon: PhSparkle },
  { path: "/applicants", label: "Applicants", icon: PhIdentificationCard },
  { path: "/jobs", label: "Jobs", icon: PhBriefcase },
  { path: "/matches", label: "Matches", icon: PhTarget },
  { path: "/applications", label: "Applications", icon: PhKanban },
  // --- Hidden from RoleFit nav (routes still registered) ---
  // {
  //   path: "/sessions",
  //   labelKey: "sessions",
  //   label: "Sessions",
  //   icon: MessageSquare,
  // },
  // { path: "/files", label: "Files", icon: FolderOpen },
  // {
  //   path: "/analytics",
  //   labelKey: "analytics",
  //   label: "Analytics",
  //   icon: BarChart3,
  // },
  // {
  //   path: "/models",
  //   labelKey: "models",
  //   label: "Models",
  //   icon: Cpu,
  // },
  // { path: "/logs", labelKey: "logs", label: "Logs", icon: FileText },
  // { path: "/cron", labelKey: "cron", label: "Cron", icon: Clock },
  // { path: "/skills", labelKey: "skills", label: "Skills", icon: Package },
  // { path: "/plugins", labelKey: "plugins", label: "Plugins", icon: Puzzle },
  // { path: "/mcp", label: "MCP", icon: Plug },
  // { path: "/channels", label: "Channels", icon: Radio },
  // { path: "/webhooks", label: "Webhooks", icon: Webhook },
  // { path: "/pairing", label: "Pairing", icon: ShieldCheck },
  // { path: "/profiles", labelKey: "profiles", label: "Profiles", icon: Users },
  // { path: "/config", labelKey: "config", label: "Config", icon: Settings },
  // { path: "/env", labelKey: "keys", label: "Keys", icon: KeyRound },
  // { path: "/system", label: "System", icon: Wrench },
  // {
  //   path: "/docs",
  //   labelKey: "documentation",
  //   label: "Documentation",
  //   icon: BookOpen,
  // },
];

const ICON_MAP: Record<string, ComponentType<{ className?: string }>> = {
  Activity,
  BarChart3,
  Clock,
  Cpu,
  FileText,
  FolderOpen,
  KeyRound,
  MessageSquare,
  Package,
  Settings,
  Puzzle,
  Sparkles,
  Terminal,
  Globe,
  Database,
  Shield,
  Users,
  Wrench,
  Zap,
  Heart,
  Star,
  Code,
  Eye,
};

function resolveIcon(name: string): ComponentType<{ className?: string }> {
  return ICON_MAP[name] ?? Puzzle;
}

function buildNavItems(
  builtIn: NavItem[],
  manifests: PluginManifest[],
): NavItem[] {
  const items = [...builtIn];

  for (const manifest of manifests) {
    if (manifest.tab.override) continue;
    if (manifest.tab.hidden) continue;

    const pluginItem: NavItem = {
      path: manifest.tab.path,
      label: manifest.label,
      icon: resolveIcon(manifest.icon),
    };

    const pos = manifest.tab.position ?? "end";
    if (pos === "end") {
      items.push(pluginItem);
    } else if (pos.startsWith("after:")) {
      const target = "/" + pos.slice(6);
      const idx = items.findIndex((i) => i.path === target);
      items.splice(idx >= 0 ? idx + 1 : items.length, 0, pluginItem);
    } else if (pos.startsWith("before:")) {
      const target = "/" + pos.slice(7);
      const idx = items.findIndex((i) => i.path === target);
      items.splice(idx >= 0 ? idx : items.length, 0, pluginItem);
    } else {
      items.push(pluginItem);
    }
  }

  return items;
}

/** Split merged nav into built-in sidebar entries vs plugin tabs, preserving plugin order hints. */
function partitionSidebarNav(
  builtIn: NavItem[],
  manifests: PluginManifest[],
): { coreItems: NavItem[]; pluginItems: NavItem[] } {
  const merged = buildNavItems(builtIn, manifests);
  const builtinPaths = new Set(builtIn.map((i) => i.path));
  const coreItems: NavItem[] = [];
  const pluginItems: NavItem[] = [];
  for (const item of merged) {
    if (builtinPaths.has(item.path)) coreItems.push(item);
    else pluginItems.push(item);
  }
  return { coreItems, pluginItems };
}

function buildRoutes(
  builtinRoutes: Record<string, ComponentType>,
  manifests: PluginManifest[],
): Array<{
  key: string;
  path: string;
  element: ReactNode;
}> {
  const byOverride = new Map<string, PluginManifest>();
  const addons: PluginManifest[] = [];

  for (const m of manifests) {
    if (m.tab.override) {
      byOverride.set(m.tab.override, m);
    } else {
      addons.push(m);
    }
  }

  const routes: Array<{
    key: string;
    path: string;
    element: ReactNode;
  }> = [];

  for (const [path, Component] of Object.entries(builtinRoutes)) {
    const om = byOverride.get(path);
    if (om) {
      routes.push({
        key: `override:${om.name}`,
        path,
        element: <PluginPage name={om.name} />,
      });
    } else {
      routes.push({ key: `builtin:${path}`, path, element: <Component /> });
    }
  }

  for (const m of addons) {
    if (m.tab.hidden) continue;
    if (m.tab.path === "/plugins") continue;
    if (builtinRoutes[m.tab.path]) continue;
    routes.push({
      key: `plugin:${m.name}`,
      path: m.tab.path,
      element: <PluginPage name={m.name} />,
    });
  }

  for (const m of manifests) {
    if (!m.tab.hidden) continue;
    if (m.tab.path === "/plugins") continue;
    if (builtinRoutes[m.tab.path] || m.tab.override) continue;
    routes.push({
      key: `plugin:hidden:${m.name}`,
      path: m.tab.path,
      element: <PluginPage name={m.name} />,
    });
  }

  return routes;
}

const SIDEBAR_COLLAPSED_KEY = "hermes-sidebar-collapsed";

export default function App() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const { manifests, loading: pluginsLoading } = usePlugins();
  const { theme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });
  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch { /* localStorage may be unavailable in private browsing */ }
      return next;
    });
  }, []);
  const isMobile = useBelowBreakpoint(1024);
  const isDesktopCollapsed = collapsed && !isMobile;
  const tooltipWarmRef = useRef(0);
  const sidebarStatus = useSidebarStatus();
  const isDocsRoute = pathname === "/docs" || pathname === "/docs/";
  const normalizedPath = pathname.replace(/\/$/, "") || "/";
  const isChatRoute = normalizedPath === "/chat";
  // /rolepilot is also a full-height chat surface (pinned composer, internal scroll)
  // for LAYOUT only — it does not render the legacy PTY ChatPage.
  const isMaestroRoute =
    normalizedPath === "/rolepilot" || normalizedPath.startsWith("/rolepilot/");
  const isFullHeightRoute = isChatRoute || isMaestroRoute;
  const embeddedChat = isDashboardEmbeddedChatEnabled();

  // `dashboard.show_token_analytics` gates the Analytics nav item.  The
  // page itself remains reachable by URL (it renders an explanation when
  // the flag is off — see AnalyticsPage), but hiding the nav entry avoids
  // surfacing misleading token/cost numbers in the sidebar.  Default off.
  const [showTokenAnalytics, setShowTokenAnalytics] = useState(false);
  useEffect(() => {
    api
      .getConfig()
      .then((cfg) => {
        const dash = (cfg?.dashboard ?? {}) as {
          show_token_analytics?: unknown;
        };
        setShowTokenAnalytics(dash.show_token_analytics === true);
      })
      .catch(() => setShowTokenAnalytics(false));
  }, []);

  // A plugin can replace the built-in /chat page via `tab.override: "/chat"`
  // in its manifest.  When one does, `buildRoutes` already swaps the route
  // element for <PluginPage /> — but we also have to suppress the
  // persistent ChatPage host below, or the plugin's page and the built-in
  // terminal would paint on top of each other.  The override is niche
  // (nothing ships overriding /chat today) but it's an advertised
  // extension point, so preserve the pre-persistence contract: when a
  // plugin owns /chat, the built-in chat UI is entirely absent.
  //
  // Waiting on `pluginsLoading` is load-bearing: manifests arrive
  // asynchronously from /api/dashboard/plugins, so on initial render
  // `chatOverriddenByPlugin` is always false.  Without the loading
  // gate, the persistent host would mount, spawn a PTY, and THEN get
  // yanked out from under the user when the plugin's manifest resolves
  // — killing the session mid-paint.  Delaying host mount by the
  // plugin-load window (typically <50ms, worst case 2s safety timeout)
  // is the cheaper trade-off.
  const chatOverriddenByPlugin = useMemo(
    () => manifests.some((m) => m.tab.override === "/chat"),
    [manifests],
  );

  const builtinRoutes = useMemo(
    () => ({
      ...BUILTIN_ROUTES_CORE,
      ...(embeddedChat ? { "/chat": ChatRouteSink } : {}),
    }),
    [embeddedChat],
  );

  const builtinNav = useMemo(() => {
    // RoleFit hides the Chat tab from the sidebar (CHAT_NAV_ITEM) — the
    // /chat route still mounts via the persistent host when embedded chat
    // is on, it's just not surfaced in the nav. Analytics is gated as
    // before (already absent from BUILTIN_NAV_REST here).
    void embeddedChat;
    return showTokenAnalytics
      ? BUILTIN_NAV_REST
      : BUILTIN_NAV_REST.filter((n) => n.path !== "/analytics");
  }, [embeddedChat, showTokenAnalytics]);

  const sidebarNav = useMemo(
    () => partitionSidebarNav(builtinNav, manifests),
    [builtinNav, manifests],
  );
  const routes = useMemo(
    () => buildRoutes(builtinRoutes, manifests),
    [builtinRoutes, manifests],
  );
  const pluginTabMeta = useMemo(
    () =>
      manifests
        .filter((m) => !m.tab.hidden)
        .map((m) => ({
          path: m.tab.override ?? m.tab.path,
          label: m.label,
        })),
    [manifests],
  );

  const layoutVariant = theme.layoutVariant ?? "standard";

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [mobileOpen]);

  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setMobileOpen(false);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return (
    <ProfileProvider>
    <div
      data-layout-variant={layoutVariant}
      className="flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden bg-black text-text-primary antialiased"
    >
      <SelectionSwitcher />
      <Backdrop />
      <PluginSlot name="backdrop" />

      <header
        className={cn(
          "lg:hidden fixed top-0 left-0 right-0 z-40 min-h-14",
          "flex items-center gap-2 px-4 py-2",
          "border-b border-current/20",
          "bg-background-base/90 backdrop-blur-sm",
        )}
        style={{
          background: "var(--component-header-background)",
          borderImage: "var(--component-header-border-image)",
          clipPath: "var(--component-header-clip-path)",
        }}
      >
        <Button
          ghost
          size="icon"
          onClick={() => setMobileOpen(true)}
          aria-label={t.app.openNavigation}
          aria-expanded={mobileOpen}
          aria-controls="app-sidebar"
          className="text-text-secondary hover:text-midground"
        >
          <Menu />
        </Button>

        <Typography className="text-[1.05rem] font-semibold leading-none tracking-[-0.02em] text-foreground">
          {t.app.brand}
        </Typography>
      </header>

      {mobileOpen && (
        <Button
          ghost
          aria-label={t.app.closeNavigation}
          onClick={closeMobile}
          className={cn(
            "lg:hidden fixed inset-0 z-40 p-0 block",
            "bg-black/60 backdrop-blur-sm",
          )}
        />
      )}

      <PluginSlot name="header-banner" />
      <ProfileScopeBanner />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pt-14 lg:pt-0">
        <div className="flex min-h-0 min-w-0 flex-1">
          {/* RoleFit replaces the Hermes left sidebar with a floating macOS-style
              dock (see <RoleFitDock/> below). The sidebar is hidden, not deleted —
              flip this to true to restore the original rail. */}
          {false && (
          <aside
            id="app-sidebar"
            aria-label={t.app.navigation}
            className={cn(
              "fixed top-0 left-0 z-50 flex h-dvh max-h-dvh w-64 min-h-0 flex-col",
              "border-r border-current/20",
              "bg-background-base/95 backdrop-blur-sm",
              "transition-[transform] duration-200 ease-out",
              mobileOpen ? "translate-x-0" : "-translate-x-full",
              "lg:sticky lg:top-0 lg:translate-x-0 lg:shrink-0 lg:overflow-hidden",
              "lg:transition-[width] lg:duration-[600ms] lg:ease-[cubic-bezier(0.33,1.35,0.62,1)]",
              collapsed && "lg:w-14",
            )}
            style={{
              background: "var(--component-sidebar-background)",
              clipPath: "var(--component-sidebar-clip-path)",
              borderImage: "var(--component-sidebar-border-image)",
            }}
          >
            <div
              className={cn(
                "flex h-14 shrink-0 items-center gap-2",
                "border-b border-current/20",
                collapsed ? "lg:justify-center lg:px-0" : "px-4 justify-between",
              )}
            >
              <div
                className={cn(
                  "flex items-center gap-2",
                  collapsed && "lg:hidden",
                )}
              >
                <PluginSlot name="header-left" />

                <Typography className="text-[1.25rem] font-semibold leading-none tracking-[-0.02em] text-foreground">
                  RoleFit
                </Typography>
              </div>

              <Button
                ghost
                size="icon"
                onClick={closeMobile}
                aria-label={t.app.closeNavigation}
                className="lg:hidden text-text-secondary hover:text-midground"
              >
                <X />
              </Button>

              <Button
                ghost
                size="icon"
                onClick={toggleCollapsed}
                aria-label={
                  collapsed ? t.common.expand : t.common.collapse
                }
                className="hidden lg:flex text-text-secondary hover:text-midground"
              >
                {collapsed ? (
                  <PanelLeftOpen className="h-4 w-4" />
                ) : (
                  <PanelLeftClose className="h-4 w-4" />
                )}
              </Button>
            </div>

            {/* RoleFit is a single-team product — the Hermes dashboard/profile
                switcher is hidden (not deleted) to keep the chrome calm. */}
            {false && <ProfileSwitcher collapsed={isDesktopCollapsed} />}

            <nav
              className="min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden border-t border-current/10 py-2"
              aria-label={t.app.navigation}
            >
              <ul className="flex flex-col">
                {sidebarNav.coreItems.map((item) => (
                  <SidebarNavLink
                    closeMobile={closeMobile}
                    collapsed={isDesktopCollapsed}
                    item={item}
                    key={item.path}
                    t={t}
                    tooltipWarmRef={tooltipWarmRef}
                  />
                ))}
              </ul>

              {/* RoleFit hides the Hermes "Plugins" nav section (Achievements,
                  Kanban, …) from the sidebar — routes stay registered, just
                  not surfaced. Flip `false` to restore. */}
              {false && sidebarNav.pluginItems.length > 0 && (
                <div
                  aria-labelledby="hermes-sidebar-plugin-nav-heading"
                  className="flex flex-col border-t border-current/10 pb-2"
                  role="group"
                >
                  <span
                    className={cn(
                      "px-5 pt-2.5 pb-1",
                      "font-mondwest text-display text-xs tracking-[0.12em] text-text-tertiary",
                      isDesktopCollapsed && "lg:hidden",
                    )}
                    id="hermes-sidebar-plugin-nav-heading"
                  >
                    {t.app.pluginNavSection}
                  </span>

                  <ul className="flex flex-col">
                    {sidebarNav.pluginItems.map((item) => (
                      <SidebarNavLink
                        closeMobile={closeMobile}
                        collapsed={isDesktopCollapsed}
                        item={item}
                        key={item.path}
                        t={t}
                        tooltipWarmRef={tooltipWarmRef}
                      />
                    ))}
                  </ul>
                </div>
              )}
            </nav>

            {/* RoleFit tones down the Hermes system-action clutter: the
                "Restart Gateway"/"Update Hermes" actions are hidden inside
                SidebarSystemActions (see SHOW_SYSTEM_ACTIONS), leaving only
                a calm gateway-status indicator. Nothing is deleted. */}
            <SidebarSystemActions
              collapsed={isDesktopCollapsed}
              onNavigate={closeMobile}
              status={sidebarStatus}
              tooltipWarmRef={tooltipWarmRef}
            />

            <div
              className={cn(
                "flex shrink-0 items-center gap-2",
                "px-3 py-2",
                "border-t border-current/20",
                isDesktopCollapsed
                  ? "lg:flex-col lg:items-start lg:gap-3 lg:py-3"
                  : "justify-between",
              )}
            >
              <div
                className={cn(
                  "flex min-w-0 items-center gap-2",
                  isDesktopCollapsed && "lg:flex-col lg:items-start",
                )}
              >
                <PluginSlot name="header-right" />

                {/* RoleFit ships one premium-light theme — the theme switcher
                    is hidden (not deleted) so the look stays consistent. */}
                {false && (
                  <SidebarIconWithTooltip
                    collapsed={isDesktopCollapsed}
                    label={t.theme?.switchTheme ?? "Switch theme"}
                    tooltipWarmRef={tooltipWarmRef}
                  >
                    <ThemeSwitcher collapsed={isDesktopCollapsed} dropUp />
                  </SidebarIconWithTooltip>
                )}

                <SidebarIconWithTooltip
                  collapsed={isDesktopCollapsed}
                  label={t.language.switchTo}
                  tooltipWarmRef={tooltipWarmRef}
                >
                  <LanguageSwitcher collapsed={isDesktopCollapsed} dropUp />
                </SidebarIconWithTooltip>
              </div>
            </div>

            <div
              className={cn(
                "flex shrink-0 flex-col",
                isDesktopCollapsed && "lg:hidden",
              )}
            >
              <AuthWidget />
              <SidebarFooter status={sidebarStatus} />
            </div>
          </aside>
          )}

          <ChatProvider>
          <PageHeaderProvider pluginTabs={pluginTabMeta}>
            <div
              className={cn(
                "relative z-2 flex min-w-0 min-h-0 flex-1 flex-col",
                "px-3 sm:px-6",
                // Bottom space reserved so the floating dock never covers content.
                isFullHeightRoute
                  ? "pb-28 pt-1 sm:pt-2 lg:pt-4"
                  : "pb-28 pt-2 sm:pt-4 lg:pt-6",
                isDocsRoute && "min-h-0 flex-1",
              )}
            >
              <PluginSlot name="pre-main" />
              <div
                className={cn(
                  "w-full min-w-0",
                  !isFullHeightRoute &&
                    "pb-[calc(2rem+env(safe-area-inset-bottom,0px))] lg:pb-8",
                  (isDocsRoute || isFullHeightRoute) &&
                    "min-h-0 flex flex-1 flex-col",
                )}
              >
                <ProfileKeyedRoutes>
                  <Routes>
                    {routes.map(({ key, path, element }) => (
                      <Route key={key} path={path} element={element} />
                    ))}
                    <Route
                      path="*"
                      element={
                        <UnknownRouteFallback pluginsLoading={pluginsLoading} />
                      }
                    />
                  </Routes>
                </ProfileKeyedRoutes>

                {embeddedChat &&
                  !chatOverriddenByPlugin &&
                  (pluginsLoading ? (
                    isChatRoute ? (
                      <div
                        className="flex min-h-0 min-w-0 flex-1 items-center justify-center"
                        aria-busy="true"
                        aria-live="polite"
                      >
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Spinner />
                          <span>Loading chat…</span>
                        </div>
                      </div>
                    ) : null
                  ) : (
                    <div
                      data-chat-active={isChatRoute ? "true" : "false"}
                      className={cn(
                        "min-h-0 min-w-0",
                        isChatRoute ? "flex flex-1 flex-col" : "hidden",
                      )}
                      aria-hidden={!isChatRoute}
                    >
                      <ChatPage isActive={isChatRoute} />
                    </div>
                  ))}
              </div>
              <PluginSlot name="post-main" />
            </div>
          </PageHeaderProvider>
          </ChatProvider>
        </div>
      </div>

      <RoleFitDock items={sidebarNav.coreItems} />
      <PluginSlot name="overlay" />
    </div>
    </ProfileProvider>
  );
}

/**
 * RoleFit's primary navigation — a floating, macOS-style glass dock pinned to
 * the bottom-center of the viewport. Replaces the old Hermes left rail (hidden
 * above). Icon + label per destination; the active route reads in Apple-blue
 * with a soft tint; items lift on hover. Honors reduced-motion via CSS.
 */
function RoleFitDock({ items }: { items: NavItem[] }) {
  return (
    <nav
      aria-label="Primary"
      className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4"
    >
      <div
        className="pointer-events-auto flex items-end gap-1 rounded-[26px] border border-glass-hairline bg-card/70 px-2.5 py-2 backdrop-blur-2xl"
        style={{ boxShadow: "var(--rf-e3)" }}
      >
        {items.map((item) => {
          const Icon = item.icon as ComponentType<{
            className?: string;
            weight?: "thin" | "light" | "regular" | "bold" | "fill" | "duotone";
          }>;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              title={item.label}
              className={({ isActive }) =>
                cn(
                  "group relative flex w-[68px] flex-col items-center gap-1 rounded-[18px] px-2 py-2",
                  "transition-all duration-200 will-change-transform",
                  "hover:-translate-y-0.5",
                  isActive
                    ? "bg-accent/10 text-accent"
                    : "text-text-secondary hover:bg-muted/50 hover:text-foreground",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    className="size-[22px] transition-transform duration-200 group-hover:scale-110"
                    weight={isActive ? "fill" : "regular"}
                  />
                  <span className="text-[11px] font-medium leading-none tracking-[-0.01em]">
                    {item.label}
                  </span>
                  {isActive && (
                    <span
                      aria-hidden
                      className="absolute -bottom-0.5 h-1 w-1 rounded-full bg-accent"
                    />
                  )}
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * Remounts the entire routed page tree when the global management profile
 * changes. Pages load their data on mount; without this, a page opened
 * under profile A would keep showing A's state while writes (via the
 * fetchJSON ?profile= injection) silently targeted the newly selected
 * profile B — the exact stale-target footgun the switcher exists to kill.
 * Keying by profile resets every page's local state so it refetches under
 * the new scope. The persistent ChatPage host below handles its own
 * remount (channel keyed on scopedProfile).
 */
function ProfileKeyedRoutes({ children }: { children: ReactNode }) {
  const { profile } = useProfileScope();
  return <div key={profile || "__own__"} className="contents">{children}</div>;
}

function SidebarNavLink({
  closeMobile,
  collapsed,
  item,
  tooltipWarmRef,
  t,
}: SidebarNavLinkProps) {
  const { path, label, labelKey, icon: Icon } = item;
  const [hovered, setHovered] = useState(false);
  const [tooltipAnchor, setTooltipAnchor] = useState<HTMLElement | null>(null);

  const navLabel = labelKey
    ? ((t.app.nav as Record<string, string>)[labelKey] ?? label)
    : label;
  const showTooltip = (event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
    setHovered(true);
    setTooltipAnchor(event.currentTarget);
  };
  const hideTooltip = () => {
    setHovered(false);
    setTooltipAnchor(null);
  };

  return (
    <li
      onMouseEnter={collapsed ? showTooltip : undefined}
      onMouseLeave={collapsed ? hideTooltip : undefined}
    >
      <NavLink
        to={path}
        end={path === "/sessions"}
        onClick={closeMobile}
        aria-label={collapsed ? navLabel : undefined}
        onFocus={collapsed ? showTooltip : undefined}
        onBlur={collapsed ? hideTooltip : undefined}
        className={({ isActive }) =>
          cn(
            "group/nav relative mx-2 flex items-center gap-3 rounded-xl",
            "px-3.5 py-2.5",
            "text-sm tracking-[-0.01em]",
            "whitespace-nowrap transition-colors cursor-pointer",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            isActive
              ? "bg-accent/10 text-accent font-semibold"
              : "font-medium text-text-secondary hover:bg-muted/40 hover:text-foreground",
          )
        }
        style={{
          clipPath: "var(--component-tab-clip-path)",
        }}
      >
        {({ isActive }) => (
          <>
            <Icon className="h-4 w-4 shrink-0" />

            <span
              className={cn(
                "truncate transition-opacity duration-300",
                collapsed ? "lg:opacity-0" : "lg:opacity-100",
              )}
            >
              {navLabel}
            </span>

            {/* Apple-blue active rail (2px) — calm, reads on the light canvas. */}
            {isActive && (
              <span
                aria-hidden
                className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent"
              />
            )}
          </>
        )}
      </NavLink>

      {collapsed && hovered && tooltipAnchor && (
        <SidebarTooltip anchor={tooltipAnchor} label={navLabel} warmRef={tooltipWarmRef} />
      )}
    </li>
  );
}

function SidebarSystemActions({
  collapsed,
  onNavigate,
  status,
  tooltipWarmRef,
}: SidebarSystemActionsProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { activeAction, isBusy, isRunning, pendingAction, runAction } =
    useSystemActions();
  const canUpdateHermes = status?.can_update_hermes === true;

  const items: SystemActionItem[] = [
    {
      action: "restart",
      icon: RotateCw,
      label: t.status.restartGateway,
      runningLabel: t.status.restartingGateway,
      spin: true,
    },
  ];
  if (canUpdateHermes) {
    items.push({
      action: "update",
      icon: Download,
      label: t.status.updateHermes,
      runningLabel: t.status.updatingHermes,
      spin: false,
    });
  }

  const handleClick = (action: SystemAction) => {
    if (isBusy) return;
    void runAction(action);
    navigate("/sessions");
    onNavigate();
  };

  return (
    <div
      className={cn(
        "shrink-0 flex flex-col",
        "border-t border-current/10",
        "py-1",
      )}
    >
      {SHOW_SYSTEM_ACTIONS && (
        <>
          <span
            className={cn(
              "px-5 pt-0.5 pb-0.5",
              "font-mondwest text-display text-xs tracking-[0.12em] text-text-tertiary",
              collapsed && "lg:hidden",
            )}
          >
            {t.app.system}
          </span>

          <div className={cn(collapsed && "lg:hidden")}>
            <SidebarStatusStrip status={status} />
          </div>
        </>
      )}

      {/* Calm gateway-status indicator stays; the Restart/Update actions
          are gated off via SHOW_SYSTEM_ACTIONS for the RoleFit chrome. */}
      <GatewayDot collapsed={collapsed} status={status} tooltipWarmRef={tooltipWarmRef} />

      {SHOW_SYSTEM_ACTIONS && (
        <ul className="flex flex-col">
          {items.map((item) => (
            <SystemActionButton
              key={item.action}
              collapsed={collapsed}
              disabled={isBusy && !(pendingAction === item.action || (activeAction === item.action && isRunning))}
              tooltipWarmRef={tooltipWarmRef}
              isPending={pendingAction === item.action}
              isRunning={activeAction === item.action && isRunning && pendingAction !== item.action}
              item={item}
              onClick={() => handleClick(item.action)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** RoleFit toggle: hide the Hermes-specific "Restart Gateway" / "Update
 *  Hermes" actions + the verbose status strip from the sidebar. Flip to
 *  `true` to restore them. The gateway-status dot stays visible regardless. */
const SHOW_SYSTEM_ACTIONS = false;

function SystemActionButton({
  collapsed,
  disabled,
  isPending,
  isRunning: isActionRunning,
  item,
  onClick,
  tooltipWarmRef,
}: SystemActionButtonProps) {
  const { icon: Icon, label, runningLabel, spin } = item;
  const [hovered, setHovered] = useState(false);
  const [tooltipAnchor, setTooltipAnchor] = useState<HTMLElement | null>(null);
  const busy = isPending || isActionRunning;
  const displayLabel = isActionRunning ? runningLabel : label;
  const showTooltip = (event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
    setHovered(true);
    setTooltipAnchor(event.currentTarget);
  };
  const hideTooltip = () => {
    setHovered(false);
    setTooltipAnchor(null);
  };

  return (
    <li
      onMouseEnter={collapsed ? showTooltip : undefined}
      onMouseLeave={collapsed ? hideTooltip : undefined}
    >
      <button
        onClick={onClick}
        disabled={disabled}
        aria-busy={busy}
        aria-label={collapsed ? displayLabel : undefined}
        onFocus={collapsed ? showTooltip : undefined}
        onBlur={collapsed ? hideTooltip : undefined}
        type="button"
        className={cn(
          "group/action relative flex w-full items-center gap-3",
          "px-5 py-2.5",
          "font-mondwest text-display text-xs tracking-[0.1em]",
          "whitespace-nowrap transition-colors cursor-pointer",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-midground",
          busy
            ? "text-midground"
            : "text-text-secondary hover:text-midground",
          "disabled:text-text-disabled disabled:cursor-not-allowed",
        )}
      >
        {isPending ? (
          <Spinner className="shrink-0 text-[0.875rem]" />
        ) : isActionRunning && spin ? (
          <Spinner className="shrink-0 text-[0.875rem]" />
        ) : (
          <Icon
            className={cn(
              "h-3.5 w-3.5 shrink-0",
              isActionRunning && !spin && "animate-pulse",
            )}
          />
        )}

        <span className={cn(
          "truncate transition-opacity duration-300",
          collapsed ? "lg:opacity-0" : "lg:opacity-100",
        )}>
          {displayLabel}
        </span>

        <span
          aria-hidden
          className="absolute inset-y-0.5 left-1.5 right-1.5 bg-midground opacity-0 pointer-events-none transition-opacity duration-200 group-hover/action:opacity-5"
        />

        {busy && (
          <span
            aria-hidden
            className="absolute left-0 top-0 bottom-0 w-px bg-midground"
            style={{ mixBlendMode: "plus-lighter" }}
          />
        )}
      </button>

      {collapsed && hovered && tooltipAnchor && (
        <SidebarTooltip anchor={tooltipAnchor} label={displayLabel} warmRef={tooltipWarmRef} />
      )}
    </li>
  );
}

function SidebarIconWithTooltip({
  children,
  collapsed,
  label,
  tooltipWarmRef,
}: SidebarIconWithTooltipProps) {
  const [hovered, setHovered] = useState(false);
  const [tooltipAnchor, setTooltipAnchor] = useState<HTMLElement | null>(null);
  const showTooltip = (event: MouseEvent<HTMLDivElement>) => {
    setHovered(true);
    setTooltipAnchor(event.currentTarget);
  };
  const hideTooltip = () => {
    setHovered(false);
    setTooltipAnchor(null);
  };

  return (
    <div
      className={cn(
        "relative w-fit",
        collapsed && "group/icon",
      )}
      onMouseEnter={collapsed ? showTooltip : undefined}
      onMouseLeave={collapsed ? hideTooltip : undefined}
    >
      {children}

      {collapsed && (
        <span
          aria-hidden
          className="absolute inset-y-0 inset-x-[-0.375rem] bg-midground opacity-0 pointer-events-none transition-opacity duration-200 group-hover/icon:opacity-5 hidden lg:block"
        />
      )}

      {collapsed && hovered && tooltipAnchor && (
        <SidebarTooltip anchor={tooltipAnchor} label={label} warmRef={tooltipWarmRef} />
      )}
    </div>
  );
}

function GatewayDot({ collapsed, status, tooltipWarmRef }: GatewayDotProps) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [tooltipAnchor, setTooltipAnchor] = useState<HTMLElement | null>(null);

  const toneToColor: Record<string, string> = {
    "text-success": "bg-success",
    "text-warning": "bg-warning",
    "text-destructive": "bg-destructive",
    "text-muted-foreground": "bg-muted-foreground",
  };

  let color: string;
  let label: string;

  if (!status) {
    color = "bg-midground/20";
    label = t.status.gateway;
  } else {
    const gw = gatewayLine(status, t);
    color = toneToColor[gw.tone] ?? "bg-muted-foreground";
    label = `${t.status.gateway} ${gw.label}`;
  }
  const showTooltip = (event: MouseEvent<HTMLDivElement> | FocusEvent<HTMLDivElement>) => {
    setHovered(true);
    setTooltipAnchor(event.currentTarget);
  };
  const hideTooltip = () => {
    setHovered(false);
    setTooltipAnchor(null);
  };

  return (
    <div
      className={cn(
        "hidden lg:flex py-3 pl-[1.625rem] transition-opacity duration-300",
        collapsed ? "lg:opacity-100" : "lg:opacity-0 lg:h-0 lg:py-0 lg:overflow-hidden",
      )}
      role="status"
      aria-label={label}
      tabIndex={collapsed ? 0 : -1}
      onMouseEnter={collapsed ? showTooltip : undefined}
      onMouseLeave={collapsed ? hideTooltip : undefined}
      onFocus={collapsed ? showTooltip : undefined}
      onBlur={collapsed ? hideTooltip : undefined}
    >
      <span
        aria-hidden
        className={cn("h-1.5 w-1.5 rounded-full", color)}
      />

      {hovered && tooltipAnchor && (
        <SidebarTooltip anchor={tooltipAnchor} label={label} warmRef={tooltipWarmRef} />
      )}
    </div>
  );
}

function SidebarTooltip({ anchor, label, warmRef }: SidebarTooltipProps) {
  const rect = anchor.getBoundingClientRect();
  const sidebar = document.getElementById("app-sidebar");
  const sidebarRight = sidebar?.getBoundingClientRect().right ?? rect.right;
  const [isWarm, setIsWarm] = useState(false);

  useEffect(() => {
    if (!warmRef) {
      setIsWarm(false);
      return;
    }
    const now = Date.now();
    setIsWarm(now - warmRef.current < 300);
    warmRef.current = now;
    return () => {
      if (warmRef) warmRef.current = Date.now();
    };
  }, [warmRef]);

  return createPortal(
    <span
      className={cn(
        "fixed z-[100] pointer-events-none",
        "px-2 py-1",
        "bg-background-base/95 border border-current/20 backdrop-blur-sm shadow-lg",
        "font-mondwest text-display text-xs tracking-[0.1em] text-midground uppercase",
      )}
      style={{
        top: rect.top + rect.height / 2,
        left: sidebarRight + 8,
        transform: "translateY(-50%)",
        opacity: isWarm ? 1 : undefined,
        animation: isWarm ? "none" : "sidebar-tooltip-in 120ms ease-out",
      }}
    >
      {label}
    </span>,
    document.body,
  );
}

type TooltipWarmRef = React.RefObject<number>;

interface GatewayDotProps {
  collapsed: boolean;
  status: StatusResponse | null;
  tooltipWarmRef: TooltipWarmRef;
}

interface NavItem {
  icon: ComponentType<{ className?: string }>;
  label: string;
  labelKey?: string;
  path: string;
}

interface SidebarIconWithTooltipProps {
  children: ReactNode;
  collapsed: boolean;
  label: string;
  tooltipWarmRef: TooltipWarmRef;
}

interface SidebarNavLinkProps {
  closeMobile: () => void;
  collapsed: boolean;
  item: NavItem;
  t: Translations;
  tooltipWarmRef: TooltipWarmRef;
}

interface SidebarSystemActionsProps {
  collapsed: boolean;
  onNavigate: () => void;
  status: StatusResponse | null;
  tooltipWarmRef: TooltipWarmRef;
}

interface SidebarTooltipProps {
  anchor: HTMLElement;
  label: string;
  warmRef?: TooltipWarmRef;
}

interface SystemActionButtonProps {
  collapsed: boolean;
  disabled: boolean;
  isPending: boolean;
  isRunning: boolean;
  item: SystemActionItem;
  onClick: () => void;
  tooltipWarmRef: TooltipWarmRef;
}

interface SystemActionItem {
  action: SystemAction;
  icon: ComponentType<{ className?: string }>;
  label: string;
  runningLabel: string;
  spin: boolean;
}
