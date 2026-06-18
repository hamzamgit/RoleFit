import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { UserPlus, Warning, Gear, X, IdentificationCard, User, SealCheck } from "@phosphor-icons/react";
import { Card, CardContent } from "@nous-research/ui/ui/components/card";
import { Badge } from "@nous-research/ui/ui/components/badge";
import { Button } from "@nous-research/ui/ui/components/button";
import { Input } from "@nous-research/ui/ui/components/input";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { usePageHeader } from "@/contexts/usePageHeader";
import { api, type ProfileInfo } from "@/lib/api";
import { rolefit, type Applicant } from "@/lib/rolefit-api";

/** A native profile joined with its RoleFit applicant flags (if any). */
interface PersonRow {
  profile: ProfileInfo;
  applicant: Applicant | null;
}

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

  return (
    <Card className="bg-card rounded-[2rem] border border-border">
      <CardContent className="flex flex-col gap-6 p-8">
        {/* header: avatar + name + role/model badges */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-5">
            <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl border border-border bg-gradient-to-br from-accent/10 to-accent/25 text-accent">
              <User className="size-8" weight="duotone" />
            </div>
            <div className="min-w-0 pt-1">
              <h3 className="truncate text-xl font-bold leading-tight text-foreground">{slug}</h3>
              {profile.description ? (
                <p className="line-clamp-2 text-sm text-text-secondary">{profile.description}</p>
              ) : (
                <p className="text-sm italic text-text-tertiary">No description</p>
              )}
            </div>
          </div>
          {busy && <Spinner className="mt-1 size-4 shrink-0" />}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {agentRole && (
            <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-accent">
              {agentRole}
            </span>
          )}
          {noModel ? (
            <Badge tone="secondary" className="gap-1 text-warning">
              <Warning className="size-3" /> No model
            </Badge>
          ) : (
            <span className="rounded-full bg-muted/70 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-text-secondary">
              {profile.provider ? `${profile.provider} · ` : ""}
              {profile.model}
            </span>
          )}
        </div>

        {/* skills + default — hairline divider row */}
        <div className="flex items-center gap-6 border-y border-border/50 py-4 text-sm text-text-secondary">
          <span className="inline-flex items-center gap-2">
            <SealCheck className="size-4" /> {profile.skill_count} skills
          </span>
          {profile.is_default && <span className="text-text-tertiary">Default profile</span>}
        </div>

        {/* Tags — the main agent reads these to decide each profile's job
            (job-seeker vs other task). */}
        <div className="space-y-3">
          <label className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary">
            Tags
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {tags.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium shadow-[var(--rf-e1)]"
              >
                {t}
                <button
                  type="button"
                  className="text-text-tertiary hover:text-destructive disabled:opacity-50"
                  disabled={busy}
                  onClick={() => removeTag(t)}
                  aria-label={`Remove ${t}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <Input
              className="w-32 border-0 bg-transparent px-2 shadow-none focus-visible:ring-0"
              placeholder="Add a tag…"
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
          {tags.length === 0 && (
            <span className="text-xs italic text-text-tertiary">
              No tags — add e.g. “job-seeker”, “backend”, “data-task”
            </span>
          )}
        </div>

        {/* Background — experience/skills used for match scoring + CV generation */}
        <div className="space-y-3">
          <label className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary">
            Background
          </label>
          <textarea
            className="min-h-[80px] w-full resize-y rounded-xl border border-border bg-background/40 px-4 py-3 text-sm leading-relaxed placeholder:text-muted-foreground transition-colors focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            placeholder="e.g. Senior Frontend Engineer, 5y React/TypeScript/Next.js; built SaaS dashboards; remote, US-eligible."
            value={bg}
            disabled={busy}
            onChange={(e) => setBg(e.target.value)}
            onBlur={() => {
              if (bg !== (applicant?.background ?? "")) void save({ background: bg });
            }}
          />
        </div>

        <button
          className="w-full rounded-2xl bg-foreground py-3.5 text-sm font-bold text-background transition-all hover:brightness-110 active:scale-[0.98]"
          onClick={() => navigate("/profiles")}
        >
          <span className="inline-flex items-center justify-center gap-2">
            <Gear className="size-4" /> Edit profile
          </span>
        </button>
      </CardContent>
    </Card>
  );
}

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

  const taggedCount = rows.filter((r) => (r.applicant?.tags ?? []).length > 0).length;

  useLayoutEffect(() => {
    setEnd(
      <Button
        size="sm"
        prefix={<UserPlus className="size-4" />}
        onClick={() => navigate("/profiles/new")}
      >
        Create person
      </Button>,
    );
    return () => setEnd(null);
  }, [setEnd, navigate]);

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-6 pt-2 sm:pt-4">
      <p className="max-w-2xl text-base leading-relaxed text-text-secondary">
        People are RoleFit profiles — each its own agent (model + persona).
        Add tags so the <span className="font-semibold text-accent">main agent</span> knows
        who is a job-seeker and who is assigned to other tasks.{" "}
        {taggedCount > 0 && (
          <span className="font-semibold text-foreground">{taggedCount} tagged.</span>
        )}
      </p>

      {error && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          <span>{error}</span>
          <Button size="sm" outlined onClick={() => void load()}>
            Retry
          </Button>
        </div>
      )}

      {loading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-2xl border border-border bg-muted/40"
            />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-card/40 p-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-muted/60 text-text-tertiary">
            <IdentificationCard className="size-6" weight="duotone" />
          </span>
          <p className="max-w-sm text-sm text-text-secondary">
            No profiles yet. Create your first person to start matching jobs.
          </p>
          <Button
            prefix={<UserPlus className="size-4" />}
            onClick={() => navigate("/profiles/new")}
          >
            Create person
          </Button>
        </div>
      ) : (
        <div className="grid gap-8 xl:grid-cols-2">
          {rows.map((r) => (
            <PersonCard key={r.profile.name} row={r} onChange={onChange} />
          ))}
          <button
            onClick={() => navigate("/profiles/new")}
            className="group flex min-h-[420px] flex-col items-center justify-center gap-4 rounded-[2rem] border-2 border-dashed border-border bg-card/30 p-8 text-center transition-colors hover:border-accent/40"
          >
            <span className="flex size-20 items-center justify-center rounded-full bg-muted/60 text-text-tertiary transition-transform duration-300 group-hover:scale-110">
              <UserPlus className="size-9" />
            </span>
            <div>
              <h4 className="text-lg font-bold text-foreground">Add new applicant</h4>
              <p className="mt-1 text-sm text-text-secondary">
                Onboard a new agent to your talent pool.
              </p>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
