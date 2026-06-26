import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  UserPlus,
  Warning,
  X,
  IdentificationCard,
  SealCheck,
  Tag,
  ArrowUpRight,
  Plus,
} from "@phosphor-icons/react";
import { Button } from "@nous-research/ui/ui/components/button";
import { Input } from "@nous-research/ui/ui/components/input";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { usePageHeader } from "@/contexts/usePageHeader";
import { api, type ProfileInfo } from "@/lib/api";
import { rolefit, type Applicant } from "@/lib/rolefit-api";

/** Palette of gradient duos for avatar tiles — sampled from the RoleFit
 *  accent + Apple-blue ramp so every card feels personal but on-brand. */
const AVATAR_GRADIENTS = [
  "from-accent/15 to-accent/25",
  "from-blue-400/15 to-violet-400/20",
  "from-emerald-400/15 to-teal-400/20",
  "from-amber-400/15 to-orange-400/20",
  "from-rose-400/15 to-pink-400/20",
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function initials(slug: string): string {
  const parts = slug.replace(/[-_]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Deterministic gradient index per slug so the colour stays stable. */
function gradientIndex(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) | 0;
  return Math.abs(h) % AVATAR_GRADIENTS.length;
}

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface PersonRow {
  profile: ProfileInfo;
  applicant: Applicant | null;
}

/* ------------------------------------------------------------------ */
/*  PersonCard                                                          */
/* ------------------------------------------------------------------ */

function PersonCard({
  row,
  onChange,
}: {
  row: PersonRow;
  onChange: (slug: string, a: Applicant | null) => void;
}) {
  const navigate = useNavigate();
  const { profile, applicant } = row;
  const slug = profile.name;
  const tags = applicant?.tags ?? [];
  const agentRole = applicant?.role ?? null;
  const [tagInput, setTagInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [bg, setBg] = useState(applicant?.background ?? "");
  const grad = useMemo(() => AVATAR_GRADIENTS[gradientIndex(slug)], [slug]);

  const save = async (patch: Parameters<typeof rolefit.upsertApplicant>[1]) => {
    setBusy(true);
    try {
      onChange(slug, await rolefit.upsertApplicant(slug, patch));
    } finally {
      setBusy(false);
    }
  };

  const addTag = async () => {
    const t = tagInput.trim();
    if (!t) return;
    if (tags.some((x) => x.toLowerCase() === t.toLowerCase())) {
      setTagInput("");
      return;
    }
    setTagInput("");
    await save({ tags: [...tags, t] });
  };

  const removeTag = (t: string) =>
    save({ tags: tags.filter((x) => x !== t) });

  const noModel = !profile.model;
  const bgChanged = bg !== (applicant?.background ?? "");

  return (
    <div className="group/card relative overflow-hidden rounded-[2rem] border border-border/40 bg-card shadow-[var(--rf-e2)] transition-all duration-300 hover:shadow-[var(--rf-e3)] hover:-translate-y-0.5">
      {/* --- Header: avatar + identity + model chip --- */}
      <div className="flex items-start gap-5 p-8 pb-0">
        {/* Avatar tile — coloured gradient + initials */}
        <div
          className={`flex size-[72px] shrink-0 items-center justify-center rounded-[1.125rem] border border-white/30 bg-gradient-to-br ${grad} text-[#1d1d1f]`}
        >
          <span className="text-[28px] font-bold tracking-tight opacity-70">
            {initials(slug)}
          </span>
        </div>

        <div className="min-w-0 flex-1 pt-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-[22px] font-bold leading-tight tracking-[-0.01em] text-[#1d1d1f]">
                {slug}
              </h3>
              {profile.description ? (
                <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-[#6e6e73]">
                  {profile.description}
                </p>
              ) : (
                <p className="mt-1 text-sm italic text-[#aeaeb2]">No description</p>
              )}
            </div>
            {busy && <Spinner className="mt-1 size-4 shrink-0" />}
          </div>

          {/* Model + role chip row */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {agentRole && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/15 bg-accent/8 px-3 py-1 text-[11px] font-semibold tracking-[-0.005em] text-accent">
                {agentRole}
              </span>
            )}
            {noModel ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/20 bg-warning/5 px-3 py-1 text-[11px] font-medium text-warning">
                <Warning className="size-3" weight="fill" />
                No model configured
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-[#f5f5f7] px-3 py-1 text-[11px] font-medium text-[#6e6e73]">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                {profile.provider ? `${profile.provider} · ` : ""}
                {profile.model}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* --- Stats strip --- */}
      <div className="mx-8 mt-5 flex items-center gap-5 border-t border-border/30 pt-4 text-sm text-[#6e6e73]">
        <span className="inline-flex items-center gap-1.5">
          <SealCheck className="size-4 text-accent/70" weight="duotone" />
          <span className="font-semibold text-[#1d1d1f]">{profile.skill_count}</span> skills
        </span>
        {profile.is_default && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/40 px-2.5 py-0.5 text-[11px] font-medium">
            Default
          </span>
        )}
        {profile.distribution_name && (
          <span className="inline-flex items-center gap-1.5 text-[11px] truncate">
            <Tag className="size-3.5" />
            {profile.distribution_name}
          </span>
        )}
      </div>

      {/* --- Tags section --- */}
      <div className="mx-8 mt-5 space-y-3">
        <div className="flex items-center gap-2">
          <label className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#aeaeb2]">
            Tags
          </label>
          {tags.length > 0 && (
            <span className="text-[10px] font-medium text-[#aeaeb2]">· {tags.length}</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-2 rounded-xl border border-border/50 bg-white/70 px-3.5 py-1.5 text-[13px] font-medium leading-none text-[#1d1d1f] shadow-[var(--rf-e1)] backdrop-blur-xl transition-colors hover:border-border"
            >
              {t}
              <button
                type="button"
                className="flex size-4 items-center justify-center rounded-full text-[#aeaeb2] transition-colors hover:bg-destructive/10 hover:text-destructive"
                disabled={busy}
                onClick={() => removeTag(t)}
                aria-label={`Remove ${t}`}
              >
                <X className="size-2.5" weight="bold" />
              </button>
            </span>
          ))}
          {tags.length === 0 && !tagInput && (
            <span className="text-[12px] italic text-[#aeaeb2]">
              Add tags e.g. “job-seeker”, “backend”, “data-task”
            </span>
          )}
          <Input
            className="h-8 w-28 border-0 bg-transparent px-2 text-[13px] shadow-none placeholder:text-[#aeaeb2] focus-visible:ring-0"
            placeholder={tags.length > 0 ? "+ add" : "Add a tag…"}
            value={tagInput}
            disabled={busy}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addTag();
              }
            }}
          />
        </div>
      </div>

      {/* --- Background --- */}
      <div className="mx-8 mt-5 mb-8 space-y-3">
        <div className="flex items-center gap-2">
          <label className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#aeaeb2]">
            Background & skills
          </label>
          {bgChanged && (
            <span className="text-[10px] font-medium text-accent animate-pulse">Unsaved</span>
          )}
        </div>
        <textarea
          className="min-h-[88px] w-full resize-y rounded-2xl border border-border/50 bg-white/50 px-4 py-3 text-[13px] leading-relaxed text-[#1d1d1f] shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)] backdrop-blur-md transition-all placeholder:text-[#aeaeb2] focus:border-accent/40 focus:bg-white/85 focus:shadow-[inset_0_1px_2px_rgba(0,0,0,0.03),0_0_0_3px_rgba(0,113,227,0.12)] focus:outline-none"
          placeholder="Describe experience, skills, and preferences. Used by the agent for match scoring and tailored CVs.&#10;&#10;e.g. Senior Frontend Engineer, 5y React/TypeScript/Next.js. Built SaaS dashboards. Remote, US-eligible."
          value={bg}
          disabled={busy}
          onChange={(e) => setBg(e.target.value)}
          onBlur={() => {
            if (bg !== (applicant?.background ?? "")) void save({ background: bg });
          }}
        />
      </div>

      {/* --- Actions bar --- */}
      <div className="flex items-center gap-3 border-t border-border/20 bg-[#f5f5f7]/60 px-8 py-4">
        <Button
          size="sm"
          outlined
          prefix={<ArrowUpRight className="size-3.5" />}
          onClick={() => navigate("/profiles")}
          className="flex-1 justify-center text-[13px] font-medium"
        >
          Edit profile
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Empty State                                                         */
/* ------------------------------------------------------------------ */

function EmptyState({ onAction }: { onAction: () => void }) {
  return (
    <div className="flex flex-col items-center gap-5 rounded-[2rem] border border-dashed border-border/60 bg-[#f5f5f7]/70 py-16 text-center backdrop-blur-sm">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-white/80 text-[#aeaeb2] shadow-[var(--rf-e1)]">
        <IdentificationCard className="size-8" weight="duotone" />
      </div>
      <div className="max-w-xs space-y-1">
        <h3 className="text-lg font-bold text-[#1d1d1f]">No people yet</h3>
        <p className="text-sm leading-relaxed text-[#6e6e73]">
          Create your first person profile to start matching them with jobs.
        </p>
      </div>
      <Button prefix={<Plus className="size-4" />} onClick={onAction}>
        Create first person
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                                */
/* ------------------------------------------------------------------ */

export default function ApplicantsPage() {
  const navigate = useNavigate();
  const { setEnd } = usePageHeader();
  const [rows, setRows] = useState<PersonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ profiles }, applicants] = await Promise.all([
        api.getProfiles(),
        rolefit.listApplicants(),
      ]);
      const bySlug = new Map(applicants.map((a) => [a.profile_slug, a]));
      setRows(
        profiles.map((profile) => ({
          profile,
          applicant: bySlug.get(profile.name) ?? null,
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onChange = (slug: string, a: Applicant | null) =>
    setRows((prev) =>
      prev.map((r) => (r.profile.name === slug ? { ...r, applicant: a } : r)),
    );

  const { taggedCount, jobSeekerCount } = useMemo(() => {
    let tc = 0,
      js = 0;
    for (const r of rows) {
      if ((r.applicant?.tags ?? []).length > 0) tc++;
      if (
        (r.applicant?.role ?? "").toLowerCase() === "job-seeker" ||
        r.applicant?.tags.some((t) => t.toLowerCase().includes("seeker"))
      )
        js++;
    }
    return { taggedCount: tc, jobSeekerCount: js };
  }, [rows]);

  useLayoutEffect(() => {
    setEnd(
      <Button
        size="sm"
        prefix={<UserPlus className="size-4" />}
        onClick={() => navigate("/profiles/new")}
      >
        Add person
      </Button>,
    );
    return () => setEnd(null);
  }, [setEnd, navigate]);

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-6 pt-2 sm:pt-4">
      {/* Page description + live stats */}
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="max-w-2xl text-[15px] leading-relaxed text-[#6e6e73]">
          Each person is a RoleFit profile — its own agent with a model and persona.
          Tag them so the{" "}
          <span className="font-semibold text-accent">main agent</span> knows
          who is a job-seeker and who handles other tasks.
        </p>
        <div className="flex items-center gap-4 text-[13px] font-medium text-[#6e6e73]">
          {!loading && (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="font-semibold text-[#1d1d1f]">{rows.length}</span> profiles
              </span>
              <span className="text-border">|</span>
              <span className="inline-flex items-center gap-1.5">
                <span className="font-semibold text-[#1d1d1f]">{taggedCount}</span> tagged
              </span>
              <span className="text-border">|</span>
              <span className="inline-flex items-center gap-1.5">
                <span className="font-semibold text-[#1d1d1f]">{jobSeekerCount}</span> seekers
              </span>
            </>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-5 py-3.5 text-sm text-destructive backdrop-blur-sm">
          <span className="text-[13px] font-medium">{error}</span>
          <Button size="sm" outlined onClick={() => void load()}>
            Retry
          </Button>
        </div>
      )}

      {/* Loading skeletons */}
      {loading && (
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[420px] animate-pulse rounded-[2rem] border border-border/30 bg-card/60"
            >
              <div className="flex items-start gap-5 p-8 pb-0">
                <div className="size-[72px] shrink-0 rounded-[1.125rem] bg-muted/50" />
                <div className="flex-1 space-y-3 pt-1">
                  <div className="h-6 w-32 rounded-lg bg-muted/50" />
                  <div className="h-4 w-48 rounded-lg bg-muted/40" />
                </div>
              </div>
              <div className="mx-8 mt-5 border-t border-border/20 pt-4">
                <div className="h-4 w-24 rounded-lg bg-muted/40" />
              </div>
              <div className="mx-8 mt-5 space-y-2">
                <div className="flex gap-2">
                  <div className="h-7 w-20 rounded-xl bg-muted/50" />
                  <div className="h-7 w-16 rounded-xl bg-muted/40" />
                </div>
              </div>
              <div className="mx-8 mt-10 space-y-2">
                <div className="h-3 w-32 rounded-md bg-muted/30" />
                <div className="h-20 w-full rounded-2xl bg-muted/40" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && rows.length === 0 && (
        <EmptyState onAction={() => navigate("/profiles/new")} />
      )}

      {/* Card grid */}
      {!loading && rows.length > 0 && (
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <PersonCard key={r.profile.name} row={r} onChange={onChange} />
          ))}

          {/* Add-new card — dashed placeholder at end of grid */}
          <button
            onClick={() => navigate("/profiles/new")}
            className="group flex min-h-[440px] flex-col items-center justify-center gap-4 rounded-[2rem] border-2 border-dashed border-border/50 bg-[#f5f5f7]/50 p-8 text-center transition-all duration-300 hover:border-accent/30 hover:bg-accent/[0.02]"
          >
            <div className="flex size-[72px] items-center justify-center rounded-[1.125rem] border border-border/30 bg-white/60 text-[#aeaeb2] shadow-[var(--rf-e1)] transition-all duration-300 group-hover:scale-105 group-hover:border-accent/30 group-hover:text-accent">
              <Plus className="size-8" weight="light" />
            </div>
            <div>
              <h4 className="text-[15px] font-semibold text-[#1d1d1f]">Add new person</h4>
              <p className="mt-1 text-[13px] text-[#aeaeb2]">
                Onboard a new agent to your talent pool
              </p>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}