import { useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { CaretRight } from "@phosphor-icons/react";
import { PageHeaderContext } from "./page-header-context";
import { resolvePageTitle } from "@/lib/resolve-page-title";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

export function PageHeaderProvider({
  children,
  pluginTabs,
}: {
  children: ReactNode;
  pluginTabs: { path: string; label: string }[];
}) {
  const { pathname } = useLocation();
  const { t } = useI18n();
  const [titleOverride, setTitleOverride] = useState<string | null>(null);
  const [afterTitle, setAfterTitle] = useState<ReactNode>(null);
  const [end, setEnd] = useState<ReactNode>(null);

  // Clear any per-page title / toolbar slots when the path changes. Child routes
  // re-fill these on mount via usePageHeader.
  /* eslint-disable react-hooks/set-state-in-effect */
  useLayoutEffect(() => {
    setTitleOverride(null);
    setAfterTitle(null);
    setEnd(null);
  }, [pathname]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const defaultTitle = useMemo(
    () => resolvePageTitle(pathname, t, pluginTabs),
    [pathname, t, pluginTabs],
  );
  const displayTitle = titleOverride ?? defaultTitle;

  const isChatRoute = pathname === "/chat" || pathname === "/chat/";
  // The RoleFit Maestro page (/rolepilot) is also a full-height, internally-scrolling
  // chat surface — its composer must stay pinned, so it shares the chat layout.
  const isMaestroRoute =
    pathname === "/rolepilot" || pathname.startsWith("/rolepilot/");
  const isFullHeight = isChatRoute || isMaestroRoute;
  /** Env jump-nav is wide — stack below title on small screens so KEYS stays readable. */
  const isEnvRoute =
    pathname === "/env" || pathname.startsWith("/env/");

  const value = useMemo(
    () => ({
      setAfterTitle,
      setEnd,
      setTitle: setTitleOverride,
    }),
    [],
  );

  return (
    <PageHeaderContext.Provider value={value}>
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
        <header
          className={cn(
            "z-1 w-full shrink-0",
            "box-border border-b border-border",
            "bg-card/60 backdrop-blur-xl",
            // Mobile stacks title + toolbar — fixed height clips content; desktop stays one row.
            "min-h-0 overflow-x-hidden overflow-y-visible py-3 sm:h-16 sm:min-h-[4rem] sm:overflow-hidden sm:py-0",
          )}
          role="banner"
        >
          <div
            className={cn(
              "flex w-full min-w-0 flex-1 gap-3 px-3 sm:h-full sm:gap-3 sm:px-6",
              isChatRoute
                ? "flex-row items-center"
                : "flex-col justify-center sm:flex-row sm:items-center",
            )}
          >
            <div
              className={cn(
                "flex min-w-0 flex-1 gap-2 sm:gap-3",
                afterTitle && isEnvRoute
                  ? "flex-col items-start sm:flex-row sm:items-center"
                  : afterTitle
                    ? "flex-row flex-wrap items-center"
                    : "flex-row items-center",
              )}
            >
              {/* Brand — logo mark + wordmark. Links home to a fresh RolePilot
                  session. (Swap the inner Sparkle for the uploaded logo mark.) */}
              <Link
                to="/rolepilot"
                aria-label="RoleFit — new RolePilot session"
                className="group flex shrink-0 items-center gap-2.5"
              >
                <img
                  src="/rolepilot-logo.svg"
                  alt="RoleFit"
                  className="size-9 shrink-0 object-contain transition-transform duration-200 group-hover:scale-105"
                />
              </Link>
              <CaretRight
                aria-hidden
                weight="bold"
                className="size-3.5 shrink-0 text-text-tertiary"
              />
              <h1
                className={cn(
                  "min-w-0 text-[1.3rem] font-semibold tracking-[-0.02em] text-foreground",
                  afterTitle && isEnvRoute
                    ? "max-w-full sm:min-w-0 sm:shrink sm:truncate"
                    : afterTitle
                      ? "shrink truncate"
                      : "truncate",
                )}
                style={{ mixBlendMode: "normal" }}
              >
                {displayTitle}
              </h1>
              {afterTitle ? (
                <div
                  className={cn(
                    "min-w-0 scrollbar-none",
                    isEnvRoute
                      ? "w-full overflow-x-auto sm:flex-1 sm:overflow-x-auto"
                      : "shrink-0 overflow-visible",
                  )}
                >
                  {afterTitle}
                </div>
              ) : null}
            </div>

            {end ? (
              <div
                className={cn(
                  "flex min-w-0 sm:max-w-md sm:flex-1",
                  isChatRoute
                    ? "w-auto shrink-0 justify-end"
                    : "w-full justify-start sm:justify-end",
                )}
              >
                {end}
              </div>
            ) : null}
          </div>
        </header>

        <main
          className={cn(
            "min-h-0 w-full min-w-0 flex-1 flex flex-col",
            // Bottom inset for scrolled pages lives on the route outlet wrapper in
            // `App.tsx` (`w-full min-w-0`) so it pads scrollable content, not flex chrome.
            isFullHeight
              ? "overflow-hidden"
              : "overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]",
          )}
        >
          {children}
        </main>
      </div>
    </PageHeaderContext.Provider>
  );
}
