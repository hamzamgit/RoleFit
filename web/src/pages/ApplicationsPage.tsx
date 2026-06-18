import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { Buildings, CaretRight, CaretLeft, X, ListPlus, Sparkle, Kanban } from "@phosphor-icons/react";
import { Button } from "@nous-research/ui/ui/components/button";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { usePageHeader } from "@/contexts/usePageHeader";
import { rolefit, type Applicant, type AppCard } from "@/lib/rolefit-api";

const COL_LABEL: Record<string, string> = {
  shortlisted: "Shortlisted",
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
};

const isSeeker = (a: Applicant) =>
  (a.role || "").toLowerCase() === "job-seeker" ||
  a.tags.some((t) => t.toLowerCase().includes("seeker"));

export default function ApplicationsPage() {
  const { setEnd } = usePageHeader();
  const [seekers, setSeekers] = useState<Applicant[]>([]);
  const [person, setPerson] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [board, setBoard] = useState<Record<string, AppCard[]>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    rolefit.listApplicants().then((all) => {
      const s = all.filter(isSeeker);
      setSeekers(s);
      setPerson((p) => p ?? s[0]?.profile_slug ?? null);
    });
  }, []);

  const load = useCallback(async (slug: string | null) => {
    setLoading(true);
    try {
      const r = await rolefit.applicationsBoard(slug || undefined);
      setStatuses(r.statuses);
      setBoard(r.board);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(person);
  }, [load, person]);

  const move = async (c: AppCard, dir: 1 | -1) => {
    const i = statuses.indexOf(c.status);
    const next = statuses[i + dir];
    if (!next) return;
    await rolefit.moveApplication(c.id, next);
    await load(person);
  };
  const remove = async (c: AppCard) => {
    await rolefit.removeApplication(c.id);
    await load(person);
  };
  const trackStrong = async () => {
    if (!person) return;
    setBusy(true);
    try {
      await rolefit.trackStrong(person, 80);
      await load(person);
    } finally {
      setBusy(false);
    }
  };

  const totalCards = Object.values(board).reduce((n, cards) => n + cards.length, 0);

  useLayoutEffect(() => {
    setEnd(
      person ? (
        <Button size="sm" outlined disabled={busy} prefix={<ListPlus className="size-4" />} onClick={() => void trackStrong()}>
          {busy ? <Spinner className="size-4" /> : null} Shortlist strong (≥80)
        </Button>
      ) : null,
    );
    return () => setEnd(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setEnd, person, busy]);

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-5 pt-2 sm:pt-4">
      <p className="max-w-2xl text-sm leading-relaxed text-text-secondary">
        Application pipeline per job-seeker. Move cards across stages as you apply,
        interview, and hear back. <Sparkle className="inline size-3" /> "Shortlist
        strong" auto-adds matches ≥80.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {seekers.length === 0 ? (
          <span className="text-sm italic text-text-tertiary">No job-seekers tagged.</span>
        ) : (
          <div className="flex gap-1 rounded-xl bg-muted/40 p-1">
            {seekers.map((s) => (
              <button
                key={s.profile_slug}
                className={`rounded-lg px-5 py-1.5 text-sm font-semibold transition-colors ${
                  person === s.profile_slug
                    ? "bg-card text-foreground shadow-[var(--rf-e1)]"
                    : "text-text-secondary hover:text-foreground"
                }`}
                onClick={() => setPerson(s.profile_slug)}
              >
                {s.profile_slug}
              </button>
            ))}
          </div>
        )}

        {!loading && totalCards > 0 && (
          <div className="flex items-center gap-4 text-xs text-text-tertiary">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-accent" />
              {totalCards} tracked
            </span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-64 w-64 shrink-0 animate-pulse rounded-2xl border border-border bg-muted/40"
            />
          ))}
        </div>
      ) : statuses.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-card/40 p-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-muted/60 text-text-tertiary">
            <Kanban className="size-6" weight="duotone" />
          </span>
          <p className="max-w-sm text-sm text-text-secondary">
            Nothing tracked yet. Shortlist strong matches to start the pipeline.
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-5 overflow-x-auto pb-2">
          {statuses.map((st) => (
            <div key={st} className="flex w-72 shrink-0 flex-col gap-4">
              <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold tracking-wide text-text-secondary">
                    {COL_LABEL[st] || st}
                  </h3>
                  <span className="rounded-full bg-muted/70 px-2 py-0.5 text-[11px] font-bold text-text-tertiary">
                    {(board[st] || []).length}
                  </span>
                </div>
              </div>
              <div className="bg-card/40 flex min-h-0 flex-1 flex-col gap-4 rounded-2xl border border-border p-3">
                {(board[st] || []).map((c) => (
                  <div
                    key={c.id}
                    className="bg-card group rounded-2xl border border-border p-4"
                  >
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/60 text-text-secondary">
                        <Buildings className="size-5" />
                      </span>
                      {c.match_score != null && (
                        <span
                          className={`rounded-full px-2 py-1 text-[10px] font-black ${
                            c.match_score >= 80
                              ? "bg-accent/10 text-accent"
                              : "bg-muted/70 text-text-secondary"
                          }`}
                        >
                          {c.match_score}% match
                        </span>
                      )}
                    </div>
                    <h4 className="mb-1 font-bold leading-tight text-foreground">
                      {c.title || "—"}
                    </h4>
                    <p className="text-xs font-medium text-text-secondary">{c.company || "—"}</p>
                    <div className="mt-3 flex items-center gap-1 border-t border-border/50 pt-3 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        className="text-text-tertiary hover:text-foreground disabled:opacity-30"
                        disabled={statuses.indexOf(c.status) === 0}
                        onClick={() => void move(c, -1)}
                        title="Back"
                      >
                        <CaretLeft className="size-4" />
                      </button>
                      <button
                        className="text-text-tertiary hover:text-foreground disabled:opacity-30"
                        disabled={statuses.indexOf(c.status) === statuses.length - 1}
                        onClick={() => void move(c, 1)}
                        title="Forward"
                      >
                        <CaretRight className="size-4" />
                      </button>
                      {c.url && (
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] font-semibold text-text-tertiary hover:text-foreground"
                        >
                          open
                        </a>
                      )}
                      <button
                        className="ml-auto text-text-tertiary hover:text-destructive"
                        onClick={() => void remove(c)}
                        title="Remove"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                {(board[st] || []).length === 0 && (
                  <div className="flex flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed border-border/50 px-4 py-10 text-center text-[10px] font-bold uppercase tracking-widest text-text-tertiary/60">
                    No cards
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
