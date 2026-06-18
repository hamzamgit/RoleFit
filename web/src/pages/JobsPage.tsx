import { Fragment, useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  Buildings, MapPin, ArrowSquareOut, ArrowsClockwise, CaretDown,
  CheckCircle, XCircle, CircleDashed, SlidersHorizontal, Globe,
  Play, X, Briefcase, MagnifyingGlass, Info, Warning, Copy, Check,
} from "@phosphor-icons/react";
import { Button } from "@nous-research/ui/ui/components/button";
import { Input } from "@nous-research/ui/ui/components/input";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { Markdown } from "@/components/Markdown";
import { usePageHeader } from "@/contexts/usePageHeader";
import { rolefit, type Job, type JobDetail, type QualifyCounts } from "@/lib/rolefit-api";

type Filter = "all" | "yes" | "no" | "pending";

function StepIcon({ verdict }: { verdict?: string }) {
  if (verdict === "qualified")
    return (
      <span className="z-1 flex size-6 items-center justify-center rounded-full border border-success/20 bg-success/10 text-success">
        <Check className="size-3.5" weight="bold" />
      </span>
    );
  if (verdict === "disqualified")
    return (
      <span className="z-1 flex size-6 items-center justify-center rounded-full border border-destructive/20 bg-destructive/10 text-destructive">
        <X className="size-3.5" weight="bold" />
      </span>
    );
  return (
    <span className="z-1 flex size-6 items-center justify-center rounded-full border border-border bg-muted/60 text-text-tertiary">
      <CircleDashed className="size-3.5" />
    </span>
  );
}

function QualifyPanel({ d }: { d: JobDetail }) {
  return (
    <div className="mb-4 space-y-4">
      {/* disqualified reason banner */}
      {d.qualified === 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-destructive/15 bg-destructive/5 p-4">
          <Warning className="mt-0.5 size-5 shrink-0 text-destructive" weight="fill" />
          <div>
            <h4 className="text-sm font-semibold text-destructive">
              Disqualified{d.qualify_reason ? ` — ${d.qualify_reason}` : ""}
            </h4>
          </div>
        </div>
      )}
      {d.qualified === 1 && d.qualify_reason && (
        <div className="flex items-start gap-3 rounded-2xl border border-success/15 bg-success/5 p-4">
          <CheckCircle className="mt-0.5 size-5 shrink-0 text-success" weight="fill" />
          <h4 className="text-sm font-semibold text-success">Qualified — {d.qualify_reason}</h4>
        </div>
      )}

      {/* qualification trace */}
      <div className="space-y-3">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">
          Qualification trace
        </h4>
        {d.qualify_trace.length > 0 ? (
          <ol className="relative ml-3 flex flex-col gap-3 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-px before:bg-border">
            {d.qualify_trace.map((s, i) => (
              <li key={i} className="relative flex gap-3 text-xs">
                <StepIcon verdict={s.verdict} />
                <div className="pt-0.5">
                  <div className="font-medium text-text-secondary">
                    {s.title}
                    {s.confidence && (
                      <span className="ml-1 text-text-tertiary">({s.confidence} confidence)</span>
                    )}
                    {s.verdict && (
                      <span
                        className={`ml-1 ${s.verdict === "qualified" ? "text-success" : "text-destructive"}`}
                      >
                        → {s.verdict}
                      </span>
                    )}
                  </div>
                  {s.query && (
                    <div className="mt-0.5 inline-flex items-center gap-1 text-text-tertiary">
                      <Globe className="size-3" /> searched:{" "}
                      <span className="font-mono">{s.query}</span>
                    </div>
                  )}
                  {s.found && (
                    <div className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-text-tertiary">
                      {s.found}
                    </div>
                  )}
                  {s.detail && <div className="mt-0.5 text-text-secondary">{s.detail}</div>}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="text-xs italic text-text-tertiary">
            Not evaluated yet. Open the Requirements panel → Evaluate to flag this job.
          </div>
        )}
      </div>
    </div>
  );
}

function CopyRawButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent transition-colors hover:text-accent/80"
    >
      {copied ? "Copied" : "Copy raw text"}
      {copied ? <Check className="size-3.5" weight="bold" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function QualifyBadge({ job }: { job: Job }) {
  if (job.qualified === 1)
    return (
      <span
        className="flex size-7 items-center justify-center rounded-lg bg-success/10 text-success"
        title={job.qualify_reason || "Qualified"}
      >
        <CheckCircle className="size-[18px]" weight="fill" />
      </span>
    );
  if (job.qualified === 0)
    return (
      <span
        className="flex size-7 items-center justify-center rounded-lg bg-destructive/10 text-destructive"
        title={job.qualify_reason || "Disqualified"}
      >
        <XCircle className="size-[18px]" weight="fill" />
      </span>
    );
  return (
    <span
      className="flex size-7 items-center justify-center rounded-lg bg-muted/60 text-text-tertiary"
      title="Not evaluated"
    >
      <CircleDashed className="size-[18px]" />
    </span>
  );
}

function timeAgo(ts: number): string {
  const s = Date.now() / 1000 - ts;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function fieldLabel(f: string): string {
  return f
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function cellValue(v: unknown): string {
  if (v == null || v === "") return "—";
  return String(v);
}

export default function JobsPage() {
  const { setEnd } = usePageHeader();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [fields, setFields] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, JobDetail | null>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [counts, setCounts] = useState<QualifyCounts | null>(null);
  const [reqOpen, setReqOpen] = useState(false);
  const [reqText, setReqText] = useState("");
  const [reqSaved, setReqSaved] = useState("");
  const [evaluating, setEvaluating] = useState(false);
  const [srcBusy, setSrcBusy] = useState<string | null>(null);
  const [pipeBusy, setPipeBusy] = useState(false);
  const [digest, setDigest] = useState<string | null>(null);

  const pullSource = async (source: string) => {
    setSrcBusy(source);
    try {
      await rolefit.pullSource(source);
      await load(search, filter);
    } finally {
      setSrcBusy(null);
    }
  };

  const runPipeline = async () => {
    setPipeBusy(true);
    setDigest(null);
    try {
      const r = await rolefit.runPipeline({ research: false, generate_min: 80 });
      setDigest(r.digest);
      await load(search, filter);
    } finally {
      setPipeBusy(false);
    }
  };

  const toggle = useCallback(
    async (id: string) => {
      if (open === id) {
        setOpen(null);
        return;
      }
      setOpen(id);
      if (detail[id] === undefined) {
        try {
          const j = await rolefit.getJob(id);
          setDetail((d) => ({ ...d, [id]: j }));
        } catch {
          setDetail((d) => ({ ...d, [id]: null }));
        }
      }
    },
    [open, detail],
  );

  const load = useCallback(async (q?: string, f: Filter = "all") => {
    setLoading(true);
    setError(null);
    try {
      const r = await rolefit.listJobs({
        limit: 200,
        search: q || undefined,
        qualified: f === "all" ? undefined : f,
      });
      setJobs(r.jobs);
      setFields(r.display_fields);
      setTotal(r.total);
      setCounts(r.qualify_counts);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(search, filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, filter]);

  useEffect(() => {
    rolefit
      .getRequirements()
      .then((r) => {
        setReqText(r.requirements);
        setReqSaved(r.requirements);
      })
      .catch(() => {});
  }, []);

  const saveReq = async () => {
    await rolefit.setRequirements(reqText);
    setReqSaved(reqText);
  };

  const runEvaluate = async (research: boolean) => {
    setEvaluating(true);
    try {
      await rolefit.evaluateJobs({ all: true, research });
      await load(search, filter);
    } finally {
      setEvaluating(false);
    }
  };

  useLayoutEffect(() => {
    setEnd(
      <div className="flex items-center gap-2">
        <span className="text-sm text-text-secondary">{total} jobs</span>
        <Button size="sm" outlined prefix={<ArrowsClockwise className="size-4" />} onClick={() => void load(search)}>
          Refresh
        </Button>
      </div>,
    );
    return () => setEnd(null);
  }, [setEnd, total, load, search]);

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-5 pt-2 sm:pt-4">
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <Info className="size-4 shrink-0 text-accent" weight="fill" />
        <p>
          One shared pool pulled daily from Apify. Columns after Location are chosen by
          the main agent. Click a row for the full description.
        </p>
      </div>

      <div className="bg-card flex items-center gap-1 rounded-2xl border border-border p-1.5">
        <div className="flex flex-1 items-center gap-2 px-3">
          <MagnifyingGlass className="size-4 shrink-0 text-text-tertiary" />
          <Input
            className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            placeholder="Search roles, skills, or companies…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void load(search);
            }}
          />
        </div>
        <Button ghost size="sm" onClick={() => void load(search, filter)}>
          Search
        </Button>
        <Button
          outlined
          size="sm"
          prefix={<SlidersHorizontal className="size-4" />}
          onClick={() => setReqOpen((o) => !o)}
        >
          Requirements
        </Button>
      </div>

      {/* Free sources + autonomous pipeline */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs text-text-tertiary">Free sources:</span>
          {(["remoteok", "greenhouse", "lever"] as const).map((s) => (
            <button
              key={s}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/30 px-4 py-1.5 text-xs font-semibold capitalize text-text-secondary transition-colors hover:bg-muted/60 disabled:opacity-40"
              disabled={srcBusy === s || s !== "remoteok"}
              title={s === "remoteok" ? "Pull free RemoteOK jobs" : "Needs a company board token (use RolePilot)"}
              onClick={() => void pullSource(s)}
            >
              {srcBusy === s ? <Spinner className="size-3.5" /> : <Globe className="size-3.5" />} {s}
            </button>
          ))}
        </div>
        <Button
          prefix={<Play className="size-4" weight="fill" />}
          disabled={pipeBusy}
          title="Flag → score → generate strong matches → digest (no new paid pull)"
          onClick={() => void runPipeline()}
        >
          {pipeBusy ? <Spinner className="size-4" /> : null} Run pipeline now
        </Button>
      </div>

      {digest && (
        <div className="relative rounded-xl border border-border bg-background/40 p-4">
          <button
            className="absolute right-2 top-2 text-text-tertiary hover:text-foreground"
            onClick={() => setDigest(null)}
          >
            <X className="size-4" />
          </button>
          <div className="text-sm [&_h1]:text-base [&_table]:text-xs">
            <Markdown content={digest} />
          </div>
        </div>
      )}

      {/* Company-requirements panel — the Requirement Agent flags jobs against these */}
      {reqOpen && (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-background/30 p-4">
          <div className="text-xs font-medium text-text-secondary">
            Company requirements — the Requirement Agent flags every job qualify/disqualify against these.
          </div>
          <textarea
            className="min-h-[70px] w-full resize-y rounded-lg border border-border bg-background/40 px-3 py-2 text-sm placeholder:text-muted-foreground transition-colors focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            placeholder="e.g. Remote roles only; candidate must be US-based or US-eligible; software-engineering positions."
            value={reqText}
            onChange={(e) => setReqText(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={reqText === reqSaved} onClick={() => void saveReq()}>
              Save
            </Button>
            <Button
              size="sm"
              outlined
              disabled={evaluating || !reqSaved}
              onClick={() => void runEvaluate(false)}
            >
              {evaluating ? <Spinner className="size-4" /> : null} Evaluate all jobs
            </Button>
            <Button
              size="sm"
              outlined
              prefix={<Globe className="size-4" />}
              disabled={evaluating || !reqSaved}
              onClick={() => void runEvaluate(true)}
              title="Web-research ambiguous jobs (free)"
            >
              Evaluate + research
            </Button>
          </div>
        </div>
      )}

      {/* qualify filter chips */}
      {counts && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {([
            ["all", `All ${counts.total}`],
            ["yes", `Qualified ${counts.qualified}`],
            ["no", `No ${counts.disqualified}`],
            ["pending", `Pending ${counts.unevaluated}`],
          ] as [Filter, string][]).map(([f, label]) => (
            <button
              key={f}
              className={`rounded-full border px-4 py-1.5 font-semibold transition-colors ${
                filter === f
                  ? "border-transparent bg-foreground text-background"
                  : "border-border bg-muted/30 text-text-secondary hover:bg-muted/60"
              }`}
              onClick={() => setFilter(f)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          <span>{error}</span>
          <Button size="sm" outlined onClick={() => void load(search)}>
            Retry
          </Button>
        </div>
      )}

      {loading ? (
        <div className="h-80 animate-pulse rounded-2xl border border-border bg-muted/40" />
      ) : jobs.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-card/40 p-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-muted/60 text-text-tertiary">
            <Briefcase className="size-6" weight="duotone" />
          </span>
          <p className="max-w-sm text-sm text-text-secondary">
            No jobs yet. Use RolePilot to configure and run a pull.
          </p>
        </div>
      ) : (
        <div className="bg-card overflow-x-auto rounded-[28px] border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-1 border-b border-border bg-card/80 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-text-tertiary backdrop-blur-md">
              <tr>
                <th className="px-5 py-4 font-semibold" />
                <th className="px-5 py-4 font-semibold">Flag</th>
                <th className="px-5 py-4 font-semibold">Title</th>
                <th className="px-5 py-4 font-semibold">Company</th>
                <th className="px-5 py-4 font-semibold">Location</th>
                {fields.map((f) => (
                  <th key={f} className="px-5 py-4 font-semibold">{fieldLabel(f)}</th>
                ))}
                <th className="px-5 py-4 font-semibold">Pulled</th>
                <th className="px-5 py-4 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <Fragment key={j.id}>
                  <tr
                    className={`group cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/30 ${
                      open === j.id ? "bg-accent/5" : ""
                    }`}
                    onClick={() => void toggle(j.id)}
                  >
                    <td className="px-5 py-5 text-text-tertiary">
                      <CaretDown
                        className={`size-4 transition-transform ${open === j.id ? "rotate-180" : ""}`}
                      />
                    </td>
                    <td className="px-5 py-5"><QualifyBadge job={j} /></td>
                    <td className="px-5 py-5 font-semibold text-foreground transition-colors group-hover:text-accent">
                      {j.title || "—"}
                    </td>
                    <td className="px-5 py-5">
                      <span className="inline-flex items-center gap-1.5 text-text-secondary">
                        {j.company && <Buildings className="size-3.5" />}
                        {j.company || "—"}
                      </span>
                    </td>
                    <td className="px-5 py-5">
                      <span className="inline-flex items-center gap-1.5 text-text-secondary">
                        {j.location && <MapPin className="size-3.5" />}
                        {j.location || "—"}
                      </span>
                    </td>
                    {fields.map((f) => (
                      <td key={f} className="px-5 py-5 text-text-secondary">
                        {cellValue(j.extra?.[f])}
                      </td>
                    ))}
                    <td className="px-5 py-5 text-text-tertiary">{timeAgo(j.pulled_at)}</td>
                    <td className="px-5 py-5">
                      {j.url && (
                        <a
                          href={j.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-text-secondary hover:text-foreground"
                        >
                          Open <ArrowSquareOut className="size-3.5" />
                        </a>
                      )}
                    </td>
                  </tr>
                  {open === j.id && (
                    <tr className="border-b border-border/60 bg-muted/20">
                      <td />
                      <td colSpan={6 + fields.length} className="px-5 py-6">
                        {detail[j.id] === undefined ? (
                          <span className="inline-flex items-center gap-2 text-xs text-text-tertiary">
                            <Spinner className="size-3" /> loading…
                          </span>
                        ) : detail[j.id] ? (
                          <>
                            <QualifyPanel d={detail[j.id] as JobDetail} />
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <h4 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">
                                  Job description
                                </h4>
                                {(detail[j.id] as JobDetail).description && (
                                  <CopyRawButton
                                    text={(detail[j.id] as JobDetail).description as string}
                                  />
                                )}
                              </div>
                              {(detail[j.id] as JobDetail).description ? (
                                <pre className="bg-card max-h-72 overflow-y-auto whitespace-pre-wrap rounded-2xl border border-border p-5 font-mono text-xs leading-relaxed text-text-secondary">
                                  {(detail[j.id] as JobDetail).description}
                                </pre>
                              ) : (
                                <span className="text-xs italic text-text-tertiary">
                                  No description returned by this actor.
                                </span>
                              )}
                            </div>
                          </>
                        ) : (
                          <span className="text-xs italic text-text-tertiary">
                            Could not load job detail.
                          </span>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
