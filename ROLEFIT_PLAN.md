# RoleFit-AI — Build Plan

Fork of Nous Research **Hermes agent**. Product: a sales/recruiting tool where multiple **person-profiles** (each = a real person's CV + skills + persona) analyze the same daily-pulled job postings and produce: **Match score (0–100), tailored CV (.docx), cover letter, interview prep, skills gap, learning plan**. A conversational **main agent** sets up the daily Apify job pull and runs it autonomously.

---

## 1. What Hermes already gives us (reuse, don't rebuild)

| Need | Hermes asset | File |
|------|-------------|------|
| Web dashboard shell | React 19 + Vite + Tailwind v4 + `@nous-research/ui`, 19 pages, auth, i18n, profile scope | `web/` |
| Web backend | FastAPI :9119, WS streaming, session-token + optional OAuth | `hermes_cli/web_server.py` |
| Headless agent run | `AIAgent(...).run_conversation(msg, step_callback=…)` streaming | `run_agent.py:320` |
| Parallel per-profile fan-out | `delegate_task(tasks=[…])` ThreadPoolExecutor, isolated children, structured results | `tools/delegate_tool.py:2065` |
| Daily scheduled pull | `cron/jobs.py create_job()` — schedule + prefetch `script` + `context_from` chaining + `deliver` | `cron/jobs.py:612`, `cron/scheduler.py` |
| Persistence | SQLite `state.db` (sessions, messages, FTS, schema v16) | `hermes_state.py` |
| Skills format | `SKILL.md` = YAML frontmatter + Markdown; registry | `skills/`, `tools/skills_tool.py` |

## 2. What we must BUILD (gaps)

1. **Apify integration** — none exists. Need: actor **discovery** (search Apify store), **cost preview**, **filter config**, **run + fetch results**. Build as a Hermes skill + thin Python client (`tools/` or a skill script).
2. **Docx CV generation** — only partial Office-XML infra exists. Build a `cv-docx` skill using `python-docx` (templated, ATS-safe).
3. **RoleFit data model** — new tables (people/profiles, jobs, analyses, apify_config, runs).
4. **UI pages** — Jobs list, Match dashboard (people × jobs grid), Profile detail (CV/cover/prep/gap/plan tabs), Main-agent setup chat.
5. **Orchestration** — main agent (setup + autonomous daily) and per-profile analysis fan-out.
6. **Approval-gate** — propose→justify→cost→approve→autonomous, baked into expensive tool contracts.

---

## 3. Key recommendations (where I diverge from the raw overview)

### R1. Person-profiles = Hermes OS-profiles  *(DECIDED: OS-profiles)*
Each person = a real Hermes profile `~/.hermes/profiles/<slug>/` where `SOUL.md` = their CV + persona, with their own profile memory of jobs seen. Each person literally *is* a Hermes agent.
**Reconciliation:** we ALSO keep a `people` index row in `rolefit.db` (name, slug, skills, cv_path) so the dashboard can query fast without scanning profile dirs. The row's `profile_slug` links to the OS-profile.
**Scaling caveat (later):** OS-profiles per person don't go cleanly multi-tenant (one host = one `~/.hermes`). Fine for single-team MVP; revisit for multi-company SaaS (Phase 5) — may containerize per tenant or move hot personas to data-records then.
**Analysis seeding:** Stage-1 scoring uses `delegate_task` children seeded with the person's `SOUL.md` content as context (one runtime, cheap, fast). Stage-2 deep generation may run the real profile (`hermes -p <slug>`) so learning persists to that person's memory.

### R2. Two-stage analysis to control cost (BIG)
10 people × 50 jobs/day × 6 heavy outputs = ~3000 LLM doc-generations/day. Wasteful — nobody reads 3000 CVs.
- **Stage 1 — Score (cheap, every job × person):** Match score 0–100 + short rationale + skills-gap summary. Fast/cheap model. Runs automatically on every daily pull.
- **Stage 2 — Generate (expensive, gated):** CV.docx, cover letter, interview prep, full learning plan — produced **only** when match ≥ threshold **or** user clicks "Generate" on a row.

This is both cost control and better UX. Approval-gate (budget cap) sits on Stage 2 bulk runs.

### R3. Separate `rolefit.db`, don't pollute `state.db`
Hermes migrates `state.db` (schema v16) on upgrade — adding our tables there risks migration conflicts when we pull upstream. Keep RoleFit tables in their own `~/.hermes/rolefit.db`; reference Hermes `session_id` by value where needed.

### R4. Main agent = a privileged Hermes session with custom tools + the approval-gate
Setup flow (ask jobs → search actors → propose w/ cost → configure → schedule) is a normal Hermes conversation using new tools: `apify_search_actors`, `apify_estimate_cost`, `apify_configure`, `cron_schedule_pull`. Each costly/outward tool returns a preview requiring confirm before commit.

---

## 4. Proposed data model (`rolefit.db`)

```sql
people        (id, tenant_id, name, headline, cv_path, cv_text, skills_json, persona, created_at)
apify_config  (id, tenant_id, actor_id, actor_name, input_json, cost_estimate, approved, schedule, created_at)
jobs          (id, tenant_id, source, apify_run_id, title, company, location, url, description, raw_json, pulled_at)
analyses      (id, tenant_id, job_id, person_id, match_score, rationale, gap_json, stage, status,
               cv_path, cover_path, interview_path, learning_path, tokens, cost, created_at)
runs          (id, tenant_id, kind[pull|score|generate], status, cost, started_at, finished_at, log)
```

## 5. Backend (extend `hermes_cli/web_server.py`)

- `POST /api/rolefit/people` / `GET …` — CRUD people + CV upload (parse → skills_json).
- `POST /api/rolefit/setup/chat` (WS) — talk to main agent (Apify setup), stream tokens.
- `GET /api/rolefit/jobs` — list pulled jobs (filters).
- `GET /api/rolefit/matches?job_id|person_id` — analyses grid.
- `POST /api/rolefit/generate` — trigger Stage-2 for a (job, person) or batch (gated by cost preview).
- `GET /api/rolefit/artifact/{id}` — download CV/cover docx.
- Agent runs invoked via `AIAgent.run_conversation(..., step_callback=ws_push)`.

## 6. UI (fork `web/`, add pages)

- `PeoplePage` — manage person-profiles + CV upload.
- `SetupChatPage` — main-agent Apify onboarding (reuse xterm/WS chat embed).
- `JobsPage` — daily-pulled jobs table.
- `MatchDashboardPage` — people × jobs grid, match-score heatmap, drill-in.
- `AnalysisDetailPage` — tabs: Match | CV | Cover | Interview prep | Skills gap | Learning plan; "Generate" buttons (Stage 2).

## 7. Orchestration flows

**Setup (interactive, once per tenant):** main agent ↔ user → search actors → propose+cost → approve → configure filters → create daily cron.

**Daily (autonomous):** cron `script` calls Apify → upsert `jobs` → fan-out Stage-1 scoring via `delegate_task` (batched, throttled) → write `analyses` → notify ("12 new ≥80% matches").

**On-demand (gated):** user/agent triggers Stage-2 generation → cost preview → approve → produce docx artifacts.

---

## 8. Phased delivery

- **Phase 0 — Foundation:** rebrand fork, `rolefit.db` + schema, settle config, get `web/` + FastAPI running locally.
- **Phase 1 — People & CV:** People CRUD + CV upload/parse + PeoplePage.
- **Phase 2 — Apify + main agent:** Apify client + tools + setup chat + approval-gate + daily cron pull → `jobs`.
- **Phase 3 — Stage-1 scoring:** per-profile fan-out scoring → `analyses` + MatchDashboard.
- **Phase 4 — Stage-2 generation:** cv-docx skill + cover/interview/gap/learning + AnalysisDetail + gated generate.
- **Phase 5 — Multi-tenant & polish:** tenant isolation, budgets, notifications, deploy.

## 9. Decisions (LOCKED 2026-06-17)
1. **Profiles:** Hermes OS-profiles per person (SOUL.md = CV) + `people` index in `rolefit.db`. (R1 updated.)
2. **Cost model:** Two-stage. Auto-generate Stage-2 docs only when **match ≥ 80%**, plus on-demand. (R2.)
3. **Tenancy:** Single-team MVP first; add `tenant_id` columns now, defer full isolation/billing to Phase 5.
4. **First slice after Phase 0:** People & CV (CRUD + upload/parse + PeoplePage).
