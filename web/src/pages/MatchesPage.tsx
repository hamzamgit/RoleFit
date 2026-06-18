import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  Buildings, MapPin, Sparkle, ArrowsClockwise, DownloadSimple,
  ThumbsUp, ThumbsDown, ListPlus, Target, Warning,
} from "@phosphor-icons/react";
import { Button } from "@nous-research/ui/ui/components/button";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { usePageHeader } from "@/contexts/usePageHeader";
import { rolefit, type Applicant, type Match } from "@/lib/rolefit-api";

/** Colored circular progress ring: green ≥80 / blue mid / amber low. */
function ScoreRing({ score }: { score: number }) {
  const s = Math.max(0, Math.min(100, score));
  const r = 32;
  const c = 2 * Math.PI * r;
  const offset = c - (s / 100) * c;
  const stroke = s >= 80 ? "var(--color-success)" : s >= 50 ? "var(--color-accent)" : "var(--color-warning)";
  return (
    <div className="relative size-[72px] shrink-0">
      <svg className="size-[72px] -rotate-90" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} fill="none" stroke="var(--color-muted)" strokeWidth="5" />
        <circle
          cx="36"
          cy="36"
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
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold leading-none text-foreground">{score}</span>
        <span className="text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">fit</span>
      </div>
    </div>
  );
}

const isSeeker = (a: Applicant) =>
  (a.role || "").toLowerCase() === "job-seeker" ||
  a.tags.some((t) => t.toLowerCase().includes("seeker"));

const CRIT_LABEL: Record<string, string> = {
  role_alignment: "Role",
  seniority_fit: "Seniority",
  stack_coverage: "Stack",
  logistics: "Logistics",
};

function CriteriaBars({ criteria }: { criteria: Match["criteria"] }) {
  const keys = Object.keys(criteria || {});
  if (keys.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 pt-1 sm:grid-cols-4">
      {keys.map((k) => {
        const c = criteria[k];
        const s = Math.max(0, Math.min(100, c?.score ?? 0));
        return (
          <div key={k} title={c?.evidence} className="space-y-1.5">
            <div className="flex justify-between text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
              <span>{CRIT_LABEL[k] || k}</span>
              <span>{s}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-1.5 rounded-full bg-accent transition-[width] duration-500 ease-out"
                style={{ width: `${s}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function MatchesPage() {
  const { setEnd } = usePageHeader();
  const [seekers, setSeekers] = useState<Applicant[]>([]);
  const [person, setPerson] = useState<string | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [scoring, setScoring] = useState(false);
  const [minScore, setMinScore] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [genBusy, setGenBusy] = useState<string | null>(null);

  const generate = async (m: Match) => {
    setGenBusy(m.id);
    try {
      await rolefit.generateMatch(m.person_id, m.job_id);
      await load(person, minScore);
    } finally {
      setGenBusy(null);
    }
  };

  const setFb = async (m: Match, fb: number) => {
    const next = m.feedback === fb ? 0 : fb;
    setMatches((arr) => arr.map((x) => (x.id === m.id ? { ...x, feedback: next || null } : x)));
    try {
      await rolefit.setFeedback(m.person_id, m.job_id, next);
    } catch {
      /* ignore */
    }
  };

  const [tracked, setTracked] = useState<Set<string>>(new Set());
  const track = async (m: Match) => {
    try {
      await rolefit.trackMatch(m.person_id, m.job_id);
      setTracked((s) => new Set(s).add(m.id));
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    rolefit
      .listApplicants()
      .then((all) => {
        const s = all.filter(isSeeker);
        setSeekers(s);
        setPerson((p) => p ?? s[0]?.profile_slug ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const load = useCallback(async (slug: string | null, min: number) => {
    if (!slug) {
      setMatches([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setMatches(await rolefit.listMatches({ person: slug, min_score: min || undefined }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(person, minScore);
  }, [load, person, minScore]);

  const score = async (rescore: boolean) => {
    if (!person) return;
    setScoring(true);
    try {
      await rolefit.scoreMatches({ person, rescore });
      await load(person, minScore);
    } finally {
      setScoring(false);
    }
  };

  useLayoutEffect(() => {
    setEnd(
      person ? (
        <div className="flex items-center gap-2">
          <Button size="sm" outlined disabled={scoring} prefix={<Sparkle className="size-4" />} onClick={() => void score(false)}>
            {scoring ? <Spinner className="size-4" /> : null} Score new
          </Button>
          <Button size="sm" outlined disabled={scoring} prefix={<ArrowsClockwise className="size-4" />} onClick={() => void score(true)}>
            Re-score all
          </Button>
        </div>
      ) : null,
    );
    return () => setEnd(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setEnd, person, scoring]);

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-5 pt-2 sm:pt-4">
      <p className="max-w-2xl text-base leading-relaxed text-foreground">
        {person ? <span className="font-semibold">{person}</span> : "Each job-seeker"} matches{" "}
        <span className="font-bold text-accent">{matches.length} qualified jobs</span> — score
        0–100, rationale, and skills gap. Matches ≥80 are generation-ready.
      </p>

      <div className="flex flex-wrap items-center gap-4">
        {/* person tabs */}
        {seekers.length === 0 ? (
          <span className="text-sm italic text-text-tertiary">
            No job-seekers. Tag a profile "job-seeker" on the Applicants page.
          </span>
        ) : (
          <div className="flex gap-1 rounded-full bg-muted/40 p-1">
            {seekers.map((s) => (
              <button
                key={s.profile_slug}
                className={`rounded-full px-5 py-1.5 text-sm font-semibold transition-colors ${
                  person === s.profile_slug
                    ? "bg-accent text-white shadow-[var(--rf-e1)]"
                    : "text-text-secondary hover:text-foreground"
                }`}
                onClick={() => setPerson(s.profile_slug)}
              >
                {s.profile_slug}
              </button>
            ))}
          </div>
        )}

        {seekers.length > 0 && <div className="h-6 w-px bg-border" />}

        {/* score filter */}
        <div className="flex items-center gap-1.5 text-xs">
          {[0, 40, 60, 80].map((m) => (
            <button
              key={m}
              className={`rounded-full border px-4 py-1.5 font-semibold transition-colors ${
                minScore === m
                  ? "border-border bg-card text-foreground ring-1 ring-accent/30"
                  : "border-transparent text-text-secondary hover:bg-muted/40"
              }`}
              onClick={() => setMinScore(m)}
            >
              {m === 0 ? "All" : `Over ${m}`}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-2xl border border-border bg-muted/40"
            />
          ))}
        </div>
      ) : matches.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-card/40 p-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-muted/60 text-text-tertiary">
            <Target className="size-6" weight="duotone" />
          </span>
          <p className="max-w-sm text-sm text-text-secondary">
            No matches yet. Click <strong className="text-foreground">Score new</strong> to
            score {person} against the qualified jobs.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {matches.map((m) => (
            <div
              key={m.id}
              className="bg-card flex flex-col gap-6 rounded-3xl border border-border p-6 sm:flex-row sm:items-start sm:p-8"
            >
              <ScoreRing score={m.match_score} />

              {/* center column */}
              <div className="min-w-0 flex-1 space-y-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h3 className="text-lg font-bold text-foreground">{m.title || "—"}</h3>
                    {m.match_score >= 80 ? (
                      <span className="rounded-md bg-accent/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
                        Generation-ready
                      </span>
                    ) : m.match_score >= 50 ? (
                      <span className="rounded-md bg-muted/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-text-secondary">
                        Review required
                      </span>
                    ) : (
                      <span className="rounded-md bg-muted/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-text-tertiary">
                        Low match
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-sm font-medium text-text-secondary">
                    {m.company && (
                      <span className="inline-flex items-center gap-1.5">
                        <Buildings className="size-4" /> {m.company}
                      </span>
                    )}
                    {m.location && (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="size-4" /> {m.location}
                      </span>
                    )}
                  </div>
                </div>

                {m.rationale && (
                  <p className="border-l-2 border-accent/20 pl-4 text-sm italic leading-relaxed text-text-secondary">
                    {m.rationale}
                  </p>
                )}

                <CriteriaBars criteria={m.criteria} />

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
                  {m.gap.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {m.gap.slice(0, 5).map((g, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1.5 rounded-full border border-warning/20 bg-warning/10 px-3 py-1 text-[10px] font-bold text-warning"
                        >
                          <Warning className="size-3.5" /> {g}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span />
                  )}

                  {/* feedback + track */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      title="Good match (improves future scoring)"
                      className={`inline-flex items-center gap-1 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                        m.feedback === 1 ? "border-success/50 text-success" : "border-border text-text-secondary hover:text-foreground"
                      }`}
                      onClick={() => void setFb(m, 1)}
                    >
                      <ThumbsUp className="size-3.5" weight={m.feedback === 1 ? "fill" : "regular"} /> Good
                    </button>
                    <button
                      title="Poor match (improves future scoring)"
                      className={`inline-flex items-center gap-1 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                        m.feedback === -1 ? "border-destructive/50 text-destructive" : "border-border text-text-secondary hover:text-foreground"
                      }`}
                      onClick={() => void setFb(m, -1)}
                    >
                      <ThumbsDown className="size-3.5" weight={m.feedback === -1 ? "fill" : "regular"} /> Poor
                    </button>
                    <button
                      title="Add to application tracker"
                      className={`inline-flex items-center gap-1 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                        tracked.has(m.id)
                          ? "border-success/50 text-success"
                          : "border-border text-text-secondary hover:text-foreground"
                      }`}
                      onClick={() => void track(m)}
                    >
                      <ListPlus className="size-3.5" weight={tracked.has(m.id) ? "fill" : "regular"} /> {tracked.has(m.id) ? "Tracked" : "Track"}
                    </button>
                  </div>
                </div>

                {/* Stage-2 artifacts (shown once generated) */}
                {m.cv_path && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
                    {([
                      ["cv", "CV (.docx)"],
                      ["cover", "Cover letter"],
                      ["interview", "Interview prep"],
                      ["learning", "Learning plan"],
                      ["outreach", "Outreach email"],
                      ["linkedin", "LinkedIn msg"],
                      ["keywords", "ATS keywords"],
                    ] as [string, string][]).map(([kind, label]) => (
                      <button
                        key={kind}
                        onClick={() => void rolefit.downloadArtifact(m.person_id, m.job_id, kind)}
                        className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs text-text-secondary transition-colors hover:text-foreground"
                      >
                        <DownloadSimple className="size-3" /> {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* right action column */}
              <div className="flex w-full shrink-0 flex-col gap-2 sm:w-48 sm:justify-center">
                <button
                  className="rounded-2xl bg-foreground px-4 py-4 text-center text-[11px] font-bold leading-tight text-background transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
                  disabled={genBusy === m.id}
                  onClick={() => void generate(m)}
                >
                  {genBusy === m.id ? (
                    <span className="inline-flex items-center justify-center gap-2">
                      <Spinner className="size-4" /> Generating…
                    </span>
                  ) : m.cv_path ? (
                    "Regenerate CV + cover + prep + plan"
                  ) : (
                    "Generate CV + cover + prep + plan"
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
