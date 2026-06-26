import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Briefcase,
  SealCheck,
  UsersThree,
  Sparkle,
  FileText,
  Play,
  ArrowRight,
  ChatsCircle,
  CaretRight,
  Target,
  ChatCircle,
} from "@phosphor-icons/react";
import { Button } from "@nous-research/ui/ui/components/button";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { usePageHeader } from "@/contexts/usePageHeader";
import { Markdown } from "@/components/Markdown";
import {
  rolefit,
  type Applicant,
  type Match,
  type QualifyCounts,
  type ChatSession,
} from "@/lib/rolefit-api";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const isSeeker = (a: Applicant) =>
  (a.role || "").toLowerCase() === "job-seeker" ||
  a.tags.some((t) => t.toLowerCase().includes("seeker"));

function timeAgo(ts: number): string {
  const s = Date.now() / 1000 - ts;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function initials(slug: string): string {
  const parts = slug.replace(/[-_]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const CRIT_LABEL: Record<string, string> = {
  role_alignment: "Role",
  seniority_fit: "Seniority",
  stack_coverage: "Stack",
  logistics: "Logistics",
};

/** Colored circular progress ring: green ≥80 / blue mid / amber low. (from MatchesPage) */
function ScoreRing({ score }: { score: number }) {
  const s = Math.max(0, Math.min(100, score));
  const r = 28;
  const c = 2 * Math.PI * r;
  const offset = c - (s / 100) * c;
  const stroke =
    s >= 80 ? "var(--color-success)" : s >= 50 ? "var(--color-accent)" : "var(--color-warning)";
  return (
    <div className="relative size-16 shrink-0">
      <svg className="size-16 -rotate-90" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--color-muted)" strokeWidth="5" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-base font-bold leading-none text-foreground">{score}</span>
      </div>
    </div>
  );
}

/** Thin 4-up criteria mini-bar (Role / Seniority / Stack / Logistics). */
function MiniCriteria({ criteria }: { criteria: Match["criteria"] }) {
  const keys = Object.keys(criteria || {});
  if (keys.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
      {keys.slice(0, 4).map((k) => {
        const c = criteria[k];
        const s = Math.max(0, Math.min(100, c?.score ?? 0));
        return (
          <div key={k} title={c?.evidence} className="space-y-1">
            <div className="flex justify-between text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
              <span>{CRIT_LABEL[k] || k}</span>
              <span>{s}</span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-1 rounded-full bg-accent transition-[width] duration-500 ease-out"
                style={{ width: `${s}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Data shapes                                                        */
/* ------------------------------------------------------------------ */

interface SeekerStat {
  slug: string;
  matches: number;
  strong: number;
  apps: number;
  avg: number;
}

interface DashData {
  jobsTotal: number;
  qualify: QualifyCounts;
  seekers: Applicant[];
  strong: Match[];
  funnel: { status: string; count: number }[];
  appsTotal: number;
  perSeeker: SeekerStat[];
  sessions: ChatSession[];
}

/** Canonical funnel order; any extra statuses are appended. */
const FUNNEL_ORDER = ["shortlisted", "applied", "interview", "offer", "rejected"];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/* ------------------------------------------------------------------ */
/*  Reusable bits                                                      */
/* ------------------------------------------------------------------ */

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-card rounded-3xl border border-border p-6 sm:p-7 ${className}`}>
      {children}
    </div>
  );
}

function EmptyLine({ icon: Icon, text }: { icon: typeof Target; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2.5 py-8 text-center">
      <span className="flex size-10 items-center justify-center rounded-2xl bg-muted/60 text-text-tertiary">
        <Icon className="size-5" weight="duotone" />
      </span>
      <p className="max-w-xs text-sm text-text-secondary">{text}</p>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  value,
  label,
  sub,
}: {
  icon: typeof Briefcase;
  value: number;
  label: string;
  sub?: string;
}) {
  return (
    <Card className="p-5 sm:p-5">
      <div className="flex size-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
        <Icon className="size-5" weight="duotone" />
      </div>
      <p className="mt-4 text-3xl font-bold tracking-tight text-foreground">{value}</p>
      <p className="mt-0.5 text-sm font-medium text-text-secondary">{label}</p>
      {sub && <p className="mt-3 border-t border-border/60 pt-3 text-[11px] text-text-tertiary">{sub}</p>}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Skeleton                                                           */
/* ------------------------------------------------------------------ */

function Skeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-36 animate-pulse rounded-3xl border border-border bg-muted/40" />
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="h-72 animate-pulse rounded-3xl border border-border bg-muted/40" />
        <div className="h-72 animate-pulse rounded-3xl border border-border bg-muted/40" />
      </div>
      <div className="h-80 animate-pulse rounded-3xl border border-border bg-muted/40" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function DashboardPage() {
  const { setEnd } = usePageHeader();
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Action busy states + last pipeline digest.
  const [pipelineBusy, setPipelineBusy] = useState(false);
  const [pullBusy, setPullBusy] = useState(false);
  const [scoreBusy, setScoreBusy] = useState(false);
  const [digest, setDigest] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [jobsRes, applicants, strong, board, sessions] = await Promise.all([
        rolefit.listJobs({ limit: 1 }),
        rolefit.listApplicants(),
        rolefit.listMatches({ min_score: 80 }),
        rolefit.applicationsBoard(),
        rolefit.chatSessions(),
      ]);

      const seekers = applicants.filter(isSeeker);

      // Funnel: canonical order first, extras appended.
      const counts: Record<string, number> = {};
      for (const st of board.statuses) counts[st] = (board.board[st] || []).length;
      const ordered = [
        ...FUNNEL_ORDER.filter((s) => s in counts),
        ...board.statuses.filter((s) => !FUNNEL_ORDER.includes(s.toLowerCase())),
      ];
      const funnel = ordered.map((status) => ({ status, count: counts[status] ?? 0 }));
      const appsTotal = Object.values(board.board).reduce((n, arr) => n + arr.length, 0);

      // Per-seeker aggregation: one matches + one board call each (few seekers).
      const perSeeker: SeekerStat[] = await Promise.all(
        seekers.map(async (s) => {
          const slug = s.profile_slug;
          const [ms, sb] = await Promise.all([
            rolefit.listMatches({ person: slug }),
            rolefit.applicationsBoard(slug),
          ]);
          const strongCount = ms.filter((m) => m.match_score >= 80).length;
          const avg = ms.length
            ? Math.round(ms.reduce((n, m) => n + m.match_score, 0) / ms.length)
            : 0;
          const apps = Object.values(sb.board).reduce((n, arr) => n + arr.length, 0);
          return { slug, matches: ms.length, strong: strongCount, apps, avg };
        }),
      );

      setData({
        jobsTotal: jobsRes.total,
        qualify: jobsRes.qualify_counts,
        seekers,
        strong: [...strong].sort((a, b) => b.match_score - a.match_score).slice(0, 5),
        funnel,
        appsTotal,
        perSeeker,
        sessions: [...sessions]
          .sort((a, b) => b.updated_at - a.updated_at)
          .slice(0, 6),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useLayoutEffect(() => {
    setEnd(
      <Button size="sm" outlined disabled={loading} onClick={() => void load()}>
        {loading ? <Spinner className="size-4" /> : null} Refresh
      </Button>,
    );
    return () => setEnd(null);
  }, [setEnd, loading, load]);

  // --- Pipeline actions ------------------------------------------------
  const runPipeline = async () => {
    setPipelineBusy(true);
    setActionError(null);
    try {
      const res = await rolefit.runPipeline();
      if (res?.digest) setDigest(res.digest);
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setPipelineBusy(false);
    }
  };

  const pullRemoteOK = async () => {
    setPullBusy(true);
    setActionError(null);
    try {
      await rolefit.pullSource("remoteok");
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setPullBusy(false);
    }
  };

  const scoreNew = async () => {
    setScoreBusy(true);
    setActionError(null);
    try {
      await rolefit.scoreMatches();
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setScoreBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-5 pt-2 sm:pt-4">
      {error && (
        <p className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading && !data ? (
        <Skeleton />
      ) : !data ? null : (
        <>
          {/* 1. KPI row ------------------------------------------------ */}
          <section className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-5">
            <KpiCard
              icon={Briefcase}
              value={data.jobsTotal}
              label="Total jobs"
              sub={`${data.qualify.unevaluated} pending review`}
            />
            <KpiCard
              icon={SealCheck}
              value={data.qualify.qualified}
              label="Qualified"
              sub={`${data.qualify.disqualified} disqualified`}
            />
            <KpiCard
              icon={UsersThree}
              value={data.seekers.length}
              label="Job-seekers"
              sub="Active profiles"
            />
            <KpiCard
              icon={Sparkle}
              value={data.strong.length}
              label="Strong matches"
              sub="Score ≥ 80"
            />
            <KpiCard
              icon={FileText}
              value={data.appsTotal}
              label="Applications"
              sub="Across all roles"
            />
          </section>

          {/* 2. Pipeline + Funnel ------------------------------------- */}
          <section className="grid gap-5 lg:grid-cols-2">
            {/* Pipeline */}
            <Card className="flex flex-col">
              <div className="mb-5 flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-bold text-foreground">Pipeline</h3>
                  <p className="text-sm text-text-secondary">Job pool health</p>
                </div>
                <span className="rounded-md bg-muted/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-text-tertiary">
                  Live
                </span>
              </div>

              {(() => {
                const { qualified, disqualified, unevaluated, total } = data.qualify;
                const t = total || 1;
                return (
                  <>
                    <div className="mb-4 flex h-9 w-full overflow-hidden rounded-2xl border border-border/60 bg-muted">
                      <div
                        className="h-full bg-success transition-[width] duration-700"
                        style={{ width: `${(qualified / t) * 100}%` }}
                        title={`Qualified (${qualified})`}
                      />
                      <div
                        className="h-full bg-destructive transition-[width] duration-700"
                        style={{ width: `${(disqualified / t) * 100}%` }}
                        title={`Disqualified (${disqualified})`}
                      />
                      <div
                        className="h-full bg-muted transition-[width] duration-700"
                        style={{ width: `${(unevaluated / t) * 100}%` }}
                        title={`Pending (${unevaluated})`}
                      />
                    </div>
                    <div className="mb-6 flex flex-wrap gap-x-5 gap-y-2">
                      <Legend color="bg-success" label="Qualified" n={qualified} />
                      <Legend color="bg-destructive" label="Disqualified" n={disqualified} />
                      <Legend color="bg-muted-foreground/40" label="Pending" n={unevaluated} />
                    </div>
                  </>
                );
              })()}

              <div className="mt-auto space-y-4">
                <div className="flex flex-wrap gap-2.5">
                  <Button
                    size="sm"
                    disabled={pipelineBusy}
                    prefix={pipelineBusy ? <Spinner className="size-4" /> : <Play className="size-4" weight="fill" />}
                    onClick={() => void runPipeline()}
                    className="!rounded-full !shadow-lg !shadow-black/20"
                  >
                    Run pipeline now
                  </Button>
                  <Button size="sm" outlined disabled={pullBusy} onClick={() => void pullRemoteOK()}>
                    {pullBusy ? <Spinner className="size-4" /> : null} Pull RemoteOK
                  </Button>
                  <Button size="sm" outlined disabled={scoreBusy} onClick={() => void scoreNew()}>
                    {scoreBusy ? <Spinner className="size-4" /> : null} Score new
                  </Button>
                </div>
                {actionError && <p className="text-xs text-destructive">{actionError}</p>}
                {digest ? (
                  <div className="rounded-2xl border border-border/60 bg-muted/30 p-4">
                    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-text-tertiary">
                      Last run
                    </p>
                    <Markdown content={digest} />
                  </div>
                ) : (
                  <p className="text-[11px] italic text-text-tertiary">
                    Run the pipeline to pull, qualify, and score in one pass.
                  </p>
                )}
              </div>
            </Card>

            {/* Funnel */}
            <Card>
              <div className="mb-6">
                <h3 className="text-lg font-bold text-foreground">Application funnel</h3>
                <p className="text-sm text-text-secondary">Conversion across stages</p>
              </div>
              {data.funnel.length === 0 ? (
                <EmptyLine icon={FileText} text="No applications tracked yet. Track a match to start the funnel." />
              ) : (
                (() => {
                  const max = Math.max(1, ...data.funnel.map((f) => f.count));
                  return (
                    <div className="space-y-4">
                      {data.funnel.map((f) => {
                        const rejected = f.status.toLowerCase() === "rejected";
                        return (
                          <div key={f.status} className="space-y-1.5">
                            <div className="flex justify-between px-0.5 text-xs font-semibold text-text-secondary">
                              <span>{cap(f.status)}</span>
                              <span>{f.count}</span>
                            </div>
                            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className={`h-full rounded-full transition-[width] duration-700 ${rejected ? "bg-destructive/50" : "bg-accent"}`}
                                style={{ width: `${(f.count / max) * 100}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()
              )}
            </Card>
          </section>

          {/* 3. Top matches ------------------------------------------- */}
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-foreground">Top matches</h3>
                <p className="text-sm text-text-secondary">Strongest fits across all seekers</p>
              </div>
              <Link
                to="/matches"
                className="inline-flex items-center gap-1 text-sm font-semibold text-accent transition-colors hover:text-accent/80"
              >
                View all <ArrowRight className="size-4" />
              </Link>
            </div>

            {data.strong.length === 0 ? (
              <EmptyLine
                icon={Target}
                text="No strong matches (≥80) yet. Run the pipeline or score new to surface top fits."
              />
            ) : (
              <div className="divide-y divide-border/60">
                {data.strong.map((m) => (
                  <Link
                    key={m.id}
                    to="/matches"
                    className="group -mx-3 flex flex-col gap-4 rounded-2xl px-3 py-4 transition-colors hover:bg-muted/30 md:flex-row md:items-center md:gap-6"
                  >
                    <ScoreRing score={m.match_score} />
                    <div className="min-w-0 flex-1">
                      <h4 className="truncate font-bold text-foreground transition-colors group-hover:text-accent">
                        {m.title || "—"}
                      </h4>
                      <p className="truncate text-sm text-text-secondary">
                        {[m.company, m.location].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </div>
                    <div className="md:w-80 md:shrink-0">
                      <MiniCriteria criteria={m.criteria} />
                    </div>
                    <CaretRight className="hidden size-5 shrink-0 text-text-tertiary/50 md:block" />
                  </Link>
                ))}
              </div>
            )}
          </Card>

          {/* 4. By job-seeker + Recent conversations ------------------ */}
          <section className="grid gap-5 lg:grid-cols-2">
            {/* By job-seeker */}
            <Card>
              <h3 className="mb-5 text-lg font-bold text-foreground">By job-seeker</h3>
              {data.perSeeker.length === 0 ? (
                <EmptyLine
                  icon={UsersThree}
                  text='No job-seekers yet. Tag a profile "job-seeker" on the Applicants page.'
                />
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {data.perSeeker.map((s) => {
                    const tone =
                      s.avg >= 80
                        ? "bg-success/10 text-success"
                        : s.avg >= 50
                          ? "bg-accent/10 text-accent"
                          : "bg-warning/10 text-warning";
                    return (
                      <Link
                        key={s.slug}
                        to="/matches"
                        className="group rounded-2xl border border-border bg-card/40 p-4 transition-colors hover:border-accent/30"
                      >
                        <div className="mb-4 flex items-center gap-3">
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-sm font-bold text-accent">
                            {initials(s.slug)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-foreground transition-colors group-hover:text-accent">
                              {s.slug}
                            </p>
                            <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${tone}`}>
                              {s.avg} avg
                            </span>
                          </div>
                        </div>
                        <div className="flex justify-between text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                          <SeekerStatCell label="Matches" value={s.matches} />
                          <SeekerStatCell label="Strong" value={s.strong} accent />
                          <SeekerStatCell label="Apps" value={s.apps} />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* Recent conversations */}
            <Card className="flex flex-col">
              <h3 className="mb-5 text-lg font-bold text-foreground">Recent conversations</h3>
              {data.sessions.length === 0 ? (
                <EmptyLine icon={ChatCircle} text="No conversations yet. Start one with RolePilot." />
              ) : (
                <div className="space-y-2">
                  {data.sessions.map((s) => (
                    <Link
                      key={s.session_id}
                      to={`/rolepilot/${s.session_id}`}
                      className="group flex items-center gap-3.5 rounded-2xl border border-transparent p-3 transition-colors hover:border-border hover:bg-muted/30"
                    >
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent transition-transform group-hover:scale-105">
                        <ChatsCircle className="size-5" weight="duotone" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <h4 className="truncate text-sm font-semibold text-foreground transition-colors group-hover:text-accent">
                          {s.title || "Untitled conversation"}
                        </h4>
                        <p className="text-xs text-text-tertiary">{s.message_count} messages</p>
                      </div>
                      <span className="whitespace-nowrap text-[11px] font-medium text-text-tertiary">
                        {timeAgo(s.updated_at)}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
              <div className="mt-auto pt-5">
                <Link
                  to="/rolepilot"
                  className="block w-full rounded-2xl border border-dashed border-border py-3 text-center text-xs font-bold uppercase tracking-widest text-text-tertiary transition-colors hover:bg-muted/30 hover:text-text-secondary"
                >
                  Start new chat
                </Link>
              </div>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}

function Legend({ color, label, n }: { color: string; label: string; n: number }) {
  return (
    <span className="flex items-center gap-2 text-xs font-medium text-text-secondary">
      <span className={`size-2 rounded-full ${color}`} />
      {label} ({n})
    </span>
  );
}

function SeekerStatCell({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span>{label}</span>
      <span className={`text-sm font-bold ${accent ? "text-accent" : "text-foreground"}`}>{value}</span>
    </div>
  );
}
