// RoleFit API client. Thin wrapper over the shared auth-aware `fetchJSON`.
// People themselves are NATIVE Hermes profiles (use `api.getProfiles()` from
// "@/lib/api"). RoleFit only stores applicant flags keyed by profile slug.
import { fetchJSON } from "@/lib/api";

export interface Applicant {
  profile_slug: string;
  tenant_id: string;
  is_seeker: boolean;
  target_roles: string[];
  locations: string[];
  notes: string | null;
  tags: string[];
  /** Agent-inferred role from the tags (job-seeker / recruiter / data-task / …). */
  role: string | null;
  /** Described experience/skills — used for match scoring + CV generation. */
  background: string | null;
  created_at: number;
  updated_at: number;
}

export interface ApplicantPatch {
  is_seeker?: boolean;
  target_roles?: string[];
  locations?: string[];
  notes?: string;
  tags?: string[];
  role?: string;
  background?: string;
}

export interface Job {
  id: string;
  title: string | null;
  company: string | null;
  location: string | null;
  url: string | null;
  source: string;
  pulled_at: number;
  snippet: string;
  has_description: boolean;
  /** Company-requirements flag: 1 qualified, 0 disqualified, null not evaluated. */
  qualified: number | null;
  qualify_reason: string | null;
  /** Agent-chosen dynamic fields (salary, jobType, …) — values from the raw item. */
  extra: Record<string, unknown>;
}

export interface QualifyCounts {
  total: number;
  qualified: number;
  disqualified: number;
  unevaluated: number;
}

export interface QualifyStep {
  step: string;
  title: string;
  verdict?: string;
  confidence?: string;
  detail?: string;
  query?: string;
  found?: string;
}

export interface JobDetail {
  id: string;
  title: string | null;
  company: string | null;
  location: string | null;
  url: string | null;
  description: string | null;
  qualified: number | null;
  qualify_reason: string | null;
  qualify_trace: QualifyStep[];
  fields: Record<string, unknown>;
}

export interface AgentEvent {
  type: "thinking" | "cmd" | "tool_done" | "status" | "answer" | "done";
  text?: string;
  session_id?: string | null;
}

/** Stream a main-agent turn. Calls onEvent for each event as it arrives. */
export async function agentChatStream(
  message: string,
  sessionId: string | null | undefined,
  onEvent: (e: AgentEvent) => void,
): Promise<void> {
  const token = (window as unknown as { __HERMES_SESSION_TOKEN__?: string })
    .__HERMES_SESSION_TOKEN__;
  const res = await fetch("/api/rolefit/agent/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "X-Hermes-Session-Token": token } : {}),
    },
    body: JSON.stringify({ message, session_id: sessionId ?? undefined }),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) {
        try {
          onEvent(JSON.parse(line) as AgentEvent);
        } catch {
          /* ignore partial */
        }
      }
    }
  }
}

export interface ChatSession {
  session_id: string;
  title: string;
  message_count: number;
  updated_at: number;
  started_at: number;
}
export interface ChatMessage {
  role: "user" | "agent";
  text: string;
  created_at: number;
}

export interface Criterion {
  score: number;
  evidence: string;
}
export interface Match {
  id: string;
  job_id: string;
  person_id: string;
  match_score: number;
  rationale: string;
  gap: string[];
  criteria: Record<string, Criterion>;
  feedback: number | null;
  feedback_note: string | null;
  stage: number;
  status: string;
  cv_path: string | null;
  cover_path: string | null;
  interview_path: string | null;
  learning_path: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  qualified: number | null;
}

export interface AppCard {
  id: string;
  person_id: string;
  job_id: string;
  status: string;
  notes: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  url: string | null;
  match_score: number | null;
}

export const rolefit = {
  listMatches: (params?: { person?: string; min_score?: number }) => {
    const q = new URLSearchParams();
    if (params?.person) q.set("person", params.person);
    if (params?.min_score != null) q.set("min_score", String(params.min_score));
    const qs = q.toString();
    return fetchJSON<{ matches: Match[] }>(
      `/api/rolefit/matches${qs ? `?${qs}` : ""}`,
    ).then((r) => r.matches);
  },
  scoreMatches: (params?: { person?: string; rescore?: boolean }) => {
    const q = new URLSearchParams();
    if (params?.person) q.set("person", params.person);
    if (params?.rescore) q.set("rescore", "true");
    const qs = q.toString();
    return fetchJSON<Record<string, unknown>>(
      `/api/rolefit/matches/score${qs ? `?${qs}` : ""}`,
      { method: "POST" },
    );
  },
  setFeedback: (person: string, jobId: string, feedback: number, note?: string) => {
    const q = new URLSearchParams({ person, job_id: jobId, feedback: String(feedback) });
    if (note) q.set("note", note);
    return fetchJSON<{ updated: boolean }>(`/api/rolefit/matches/feedback?${q}`, { method: "POST" });
  },
  trackMatch: (person: string, jobId: string) =>
    fetchJSON<Record<string, unknown>>(
      `/api/rolefit/applications?person=${encodeURIComponent(person)}&job_id=${encodeURIComponent(jobId)}`,
      { method: "POST" },
    ),
  trackStrong: (person: string, minScore = 80) =>
    fetchJSON<{ shortlisted: number }>(
      `/api/rolefit/applications/track-strong?person=${encodeURIComponent(person)}&min_score=${minScore}`,
      { method: "POST" },
    ),
  applicationsBoard: (person?: string) => {
    const q = person ? `?person=${encodeURIComponent(person)}` : "";
    return fetchJSON<{ statuses: string[]; board: Record<string, AppCard[]> }>(
      `/api/rolefit/applications${q}`,
    );
  },
  moveApplication: (id: string, status: string) =>
    fetchJSON<{ moved: boolean }>(
      `/api/rolefit/applications/${encodeURIComponent(id)}/move?status=${encodeURIComponent(status)}`,
      { method: "POST" },
    ),
  removeApplication: (id: string) =>
    fetchJSON<void>(`/api/rolefit/applications/${encodeURIComponent(id)}`, { method: "DELETE" }),

  generateMatch: (person: string, jobId: string) =>
    fetchJSON<{ generated: string[] } & Record<string, unknown>>(
      `/api/rolefit/generate?person=${encodeURIComponent(person)}&job_id=${encodeURIComponent(jobId)}`,
      { method: "POST" },
    ),
  /** Download an artifact via an authed fetch (browser <a> can't send the token
   * header), then trigger a save. Opens .md in a new tab, downloads .docx. */
  downloadArtifact: async (person: string, jobId: string, kind: string) => {
    const token = (window as unknown as { __HERMES_SESSION_TOKEN__?: string })
      .__HERMES_SESSION_TOKEN__;
    const res = await fetch(
      `/api/rolefit/artifact?person=${encodeURIComponent(person)}&job_id=${encodeURIComponent(jobId)}&kind=${kind}`,
      { headers: token ? { "X-Hermes-Session-Token": token } : {} },
    );
    if (!res.ok) throw new Error(`download failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const names: Record<string, string> = {
      cv: "cv.docx", cover: "cover_letter.md",
      interview: "interview_prep.md", learning: "learning_plan.md",
    };
    a.download = names[kind] || kind;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  },

  chatSessions: () =>
    fetchJSON<{ sessions: ChatSession[] }>("/api/rolefit/agent/sessions").then(
      (r) => r.sessions,
    ),
  chatMessages: (sid: string) =>
    fetchJSON<{ messages: ChatMessage[] }>(
      `/api/rolefit/agent/sessions/${encodeURIComponent(sid)}/messages`,
    ).then((r) => r.messages),
  deleteChatSession: (sid: string) =>
    fetchJSON<void>(`/api/rolefit/agent/sessions/${encodeURIComponent(sid)}`, {
      method: "DELETE",
    }),

  listJobs: (params?: { limit?: number; search?: string; qualified?: string }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.search) q.set("search", params.search);
    if (params?.qualified) q.set("qualified", params.qualified);
    const qs = q.toString();
    return fetchJSON<{
      total: number;
      qualify_counts: QualifyCounts;
      display_fields: string[];
      jobs: Job[];
    }>(`/api/rolefit/jobs${qs ? `?${qs}` : ""}`);
  },

  pullSource: (source: string, opts?: { search?: string; company?: string }) => {
    const q = new URLSearchParams({ source });
    if (opts?.search) q.set("search", opts.search);
    if (opts?.company) q.set("company", opts.company);
    return fetchJSON<{ source: string; fetched: number; added: number; total: number; error?: string }>(
      `/api/rolefit/sources/pull?${q}`,
      { method: "POST" },
    );
  },
  runPipeline: (opts?: { pull?: boolean; research?: boolean; generate_min?: number }) => {
    const q = new URLSearchParams();
    if (opts?.pull) q.set("pull", "true");
    if (opts?.research) q.set("research", "true");
    if (opts?.generate_min != null) q.set("generate_min", String(opts.generate_min));
    return fetchJSON<{ steps: Record<string, unknown>; digest: string }>(
      `/api/rolefit/pipeline/run${q.toString() ? `?${q}` : ""}`,
      { method: "POST" },
    );
  },

  getRequirements: () =>
    fetchJSON<{ requirements: string; counts: QualifyCounts }>(
      "/api/rolefit/requirements",
    ),
  setRequirements: (text: string) =>
    fetchJSON<{ requirements: string }>("/api/rolefit/requirements", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }),
  evaluateJobs: (opts?: { all?: boolean; research?: boolean }) => {
    const q = new URLSearchParams();
    if (opts?.all) q.set("all", "true");
    if (opts?.research) q.set("research", "true");
    return fetchJSON<{ evaluated: number; qualified: number; disqualified: number; researched?: number }>(
      `/api/rolefit/requirements/evaluate${q.toString() ? `?${q}` : ""}`,
      { method: "POST" },
    );
  },

  getJob: (id: string) =>
    fetchJSON<JobDetail>(`/api/rolefit/jobs/${encodeURIComponent(id)}`),

  listApplicants: () =>
    fetchJSON<{ applicants: Applicant[] }>("/api/rolefit/applicants").then(
      (r) => r.applicants,
    ),

  upsertApplicant: (slug: string, patch: ApplicantPatch) =>
    fetchJSON<Applicant>(`/api/rolefit/applicants/${encodeURIComponent(slug)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),

  deleteApplicant: (slug: string) =>
    fetchJSON<void>(`/api/rolefit/applicants/${encodeURIComponent(slug)}`, {
      method: "DELETE",
    }),
};
