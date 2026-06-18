"""RoleFit HTTP API — a self-contained FastAPI APIRouter.

Mounted into the existing Hermes web server with a single line:

    from rolefit.api import router as rolefit_router
    app.include_router(rolefit_router)

People are NATIVE Hermes profiles (managed via /api/profiles + the ProfileBuilder).
RoleFit only stores *applicant flags* (is_seeker / target roles) keyed by profile
slug; the frontend merges these with GET /api/profiles. Single-team MVP: tenant is
fixed to 'default'; swap `_tenant()` for real auth context in Phase 5.
"""

from __future__ import annotations

import json as _json
import time
from typing import Any, Iterator, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from . import applicants as _applicants
from . import chat as _chat
from . import db as _db
from . import jobs as _jobs
from . import requirements as _req
from . import scoring as _scoring
from . import applications as _applications
from .format_reply import format_reply as _format_reply
from .format_reply import needs_format as _needs_format

router = APIRouter(prefix="/api/rolefit", tags=["rolefit"])


def _tenant() -> str:
    # Phase 5: derive from authenticated user/session. MVP: single team.
    return _db.DEFAULT_TENANT


# DB schema is created/migrated lazily on first query via db.connect().


class ApplicantPatch(BaseModel):
    is_seeker: Optional[bool] = None
    target_roles: Optional[list[str]] = None
    locations: Optional[list[str]] = None
    notes: Optional[str] = None
    tags: Optional[list[str]] = None
    role: Optional[str] = None
    background: Optional[str] = None


@router.get("/applicants")
def list_applicants() -> dict[str, Any]:
    """RoleFit flags only. Frontend merges these with GET /api/profiles by slug."""
    return {"applicants": _applicants.list_applicants(tenant_id=_tenant())}


@router.put("/applicants/{slug}")
def upsert_applicant(slug: str, body: ApplicantPatch) -> dict[str, Any]:
    return _applicants.upsert_applicant(
        slug,
        tenant_id=_tenant(),
        is_seeker=body.is_seeker,
        target_roles=body.target_roles,
        locations=body.locations,
        notes=body.notes,
        tags=body.tags,
        role=body.role,
        background=body.background,
    )


# --- match scoring (Phase 3) ----------------------------------------------

@router.get("/matches")
def list_matches(person: Optional[str] = None, min_score: Optional[int] = None,
                 limit: int = 500) -> dict[str, Any]:
    return {"matches": _scoring.list_matches(
        tenant_id=_tenant(), person=person, min_score=min_score, limit=min(limit, 1000))}


@router.post("/matches/score")
def score_matches(person: Optional[str] = None, rescore: bool = False,
                  all_jobs: bool = False) -> dict[str, Any]:
    """Run Stage-1 scoring for one job-seeker, or all of them."""
    if person:
        return _scoring.score_person(person, tenant_id=_tenant(),
                                     only_qualified=not all_jobs, rescore=rescore)
    return _scoring.score_all(tenant_id=_tenant(), only_qualified=not all_jobs, rescore=rescore)


# --- Stage-2 generation (Phase 4) -----------------------------------------

_ARTIFACT_FILES = {
    "cv": "cv.docx", "cover": "cover_letter.md",
    "interview": "interview_prep.md", "learning": "learning_plan.md",
    "outreach": "outreach_email.md", "linkedin": "linkedin_message.md",
    "keywords": "ats_keywords.md",
}


@router.post("/generate")
def generate_match(person: str, job_id: str, what: Optional[str] = None) -> dict[str, Any]:
    """Generate CV/cover/interview/learning for one (person, job)."""
    from . import generate as _gen

    kinds = what.split(",") if what else None
    return _gen.generate(person, job_id, tenant_id=_tenant(), what=kinds)


@router.post("/matches/feedback")
def match_feedback(person: str, job_id: str, feedback: int, note: Optional[str] = None) -> dict[str, Any]:
    """👍 (1) / 👎 (-1) / clear (0) a match — refines future scoring."""
    return {"updated": _scoring.set_feedback(person, job_id, feedback, note=note, tenant_id=_tenant())}


# --- application tracker ---------------------------------------------------

@router.get("/applications")
def applications_board(person: Optional[str] = None) -> dict[str, Any]:
    return {"statuses": _applications.STATUSES, "board": _applications.board(person=person, tenant_id=_tenant())}


@router.post("/applications")
def applications_add(person: str, job_id: str, status: str = "shortlisted") -> dict[str, Any]:
    return _applications.add(person, job_id, status=status, tenant_id=_tenant())


@router.post("/applications/track-strong")
def applications_track_strong(person: str, min_score: int = 80) -> dict[str, Any]:
    return {"shortlisted": _applications.add_strong_matches(person, min_score=min_score, tenant_id=_tenant())}


@router.post("/applications/{app_id}/move")
def applications_move(app_id: str, status: str) -> dict[str, Any]:
    return {"moved": _applications.move(app_id, status, tenant_id=_tenant())}


@router.delete("/applications/{app_id}", status_code=204)
def applications_remove(app_id: str) -> None:
    _applications.remove(app_id, tenant_id=_tenant())


@router.get("/artifact")
def get_artifact(person: str, job_id: str, kind: str):
    """Download a generated artifact (cv/cover/interview/learning)."""
    from fastapi.responses import FileResponse

    fname = _ARTIFACT_FILES.get(kind)
    if not fname:
        raise HTTPException(400, "bad kind")
    path = _db.hermes_home() / "rolefit_artifacts" / person / job_id / fname
    if not path.is_file():
        raise HTTPException(404, "not generated yet")
    return FileResponse(str(path), filename=fname)


@router.delete("/applicants/{slug}", status_code=204)
def delete_applicant(slug: str) -> None:
    if not _applicants.delete_applicant(slug, tenant_id=_tenant()):
        raise HTTPException(404, "applicant not found")


# --- jobs (shared company pool) -------------------------------------------

@router.get("/jobs")
def list_jobs(limit: int = 100, offset: int = 0, search: Optional[str] = None,
              qualified: Optional[str] = None) -> dict[str, Any]:
    res = _jobs.list_jobs(
        tenant_id=_tenant(), limit=min(limit, 500), offset=offset, search=search,
        qualified=qualified,
    )
    return {
        "total": _jobs.count_jobs(tenant_id=_tenant()),
        "qualify_counts": _req.counts(tenant_id=_tenant()),
        **res,
    }


# --- free sources + autonomous pipeline -----------------------------------

@router.post("/sources/pull")
def sources_pull(source: str, search: Optional[str] = None,
                 company: Optional[str] = None) -> dict[str, Any]:
    """Pull jobs from a FREE source (remoteok/greenhouse/lever) — no Apify cost."""
    from . import sources as _sources
    kw: dict[str, Any] = {}
    if search:
        kw["search"] = search
    if company:
        kw["company"] = company
    return _sources.pull(source, tenant_id=_tenant(), **kw)


@router.post("/pipeline/run")
def pipeline_run(pull: bool = False, research: bool = False,
                 generate_min: int = 80) -> dict[str, Any]:
    """Run the autonomous pipeline now (flag → score → generate → digest)."""
    from . import pipeline as _pipeline
    return _pipeline.run_daily(tenant_id=_tenant(), pull=pull, research=research,
                               generate_min=generate_min)


# --- company requirements (the Requirement Agent) -------------------------

class RequirementsIn(BaseModel):
    text: str


@router.get("/requirements")
def get_requirements() -> dict[str, Any]:
    return {
        "requirements": _req.get_requirements(tenant_id=_tenant()),
        "counts": _req.counts(tenant_id=_tenant()),
    }


@router.put("/requirements")
def set_requirements(body: RequirementsIn) -> dict[str, Any]:
    return {"requirements": _req.set_requirements(body.text, tenant_id=_tenant())}


@router.post("/requirements/evaluate")
def evaluate_jobs(all: bool = False, research: bool = False) -> dict[str, Any]:
    """Run the Requirement Agent: flag jobs qualify/disqualify (optionally web-research)."""
    return _req.evaluate_jobs(tenant_id=_tenant(), only_unflagged=not all, research=research)


@router.get("/jobs/fields")
def job_fields() -> dict[str, Any]:
    """Dynamic: the actual fields the pulled jobs contain + the agent's choice."""
    return {
        "available": _jobs.discover_fields(tenant_id=_tenant()),
        "display_fields": _jobs.get_display_fields(tenant_id=_tenant()),
    }


@router.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    j = _jobs.get_job(job_id, tenant_id=_tenant())
    if not j:
        raise HTTPException(404, "job not found")
    return j


# --- main agent chat -------------------------------------------------------
# Runs one agent turn IN-PROCESS via rolefit.agent_runtime: a warm AIAgent is
# built ONCE per session_id and reused across turns (no per-turn subprocess
# startup / model handshake — 2nd+ turns are fast). The agent's NATIVE structured
# callbacks (reasoning / tool / stream-delta) are streamed, so thinking, tool
# activity, and the assistant answer arrive as cleanly separated events.
#
# agent_runtime.run_turn() yields raw per-token deltas; we coalesce them here
# into the NDJSON shape the frontend expects (one accumulated `answer`, readable
# `thinking` chunks, `cmd`/`tool_done` activity), then a final `done` event.

from . import agent_runtime as _agent_runtime  # noqa: E402

_AGENT_SKILL = "rolefit-job-setup"


class AgentChatIn(BaseModel):
    message: str
    session_id: Optional[str] = None


def _new_session_id() -> str:
    """Stable id used as BOTH the agent_runtime cache key and the agent's own
    session_id, so resumes (frontend passes it back) hit the warm cached agent."""
    import uuid as _uuid

    return _uuid.uuid4().hex[:12]


# Flush a buffered thinking chunk on these boundaries so the live feed shows
# readable phrases instead of one-character-per-event spam.
_THINK_FLUSH = (". ", "! ", "? ", "\n")


def _agent_stream(message: str, session_id: Optional[str]) -> Iterator[bytes]:
    sid = session_id or _new_session_id()

    think_buf: list[str] = []
    answer_parts: list[str] = []

    def _flush_thinking() -> Optional[bytes]:
        if not think_buf:
            return None
        text = "".join(think_buf).strip()
        think_buf.clear()
        if not text:
            return None
        return (_json.dumps({"type": "thinking", "text": text}) + "\n").encode()

    final_answer = ""
    try:
        gen = _agent_runtime.run_turn(sid, message)
        while True:
            try:
                ev = next(gen)
            except StopIteration as stop:
                final_answer = (stop.value or "").strip()
                break

            etype = ev.get("type")
            if etype == "thinking":
                # Coalesce token-level reasoning into sentence-ish chunks.
                think_buf.append(ev.get("text", ""))
                joined = "".join(think_buf)
                if any(joined.endswith(b) for b in _THINK_FLUSH) or len(joined) > 280:
                    out = _flush_thinking()
                    if out:
                        yield out
            elif etype == "answer":
                # Buffer answer deltas; emit one accumulated block at the end so
                # the frontend (which \n-joins answer events) gets clean prose.
                answer_parts.append(ev.get("text", ""))
                # flush any pending thinking before the answer starts rendering
                out = _flush_thinking()
                if out:
                    yield out
            elif etype == "cmd":
                out = _flush_thinking()
                if out:
                    yield out
                yield (_json.dumps({"type": "cmd", "text": ev.get("text", "")}) + "\n").encode()
            elif etype == "tool_done":
                yield (_json.dumps({"type": "tool_done"}) + "\n").encode()

        # turn finished — flush any trailing thinking
        out = _flush_thinking()
        if out:
            yield out

        answer = final_answer or "".join(answer_parts).strip()
        # Light optional cleanup only when the answer still carries reasoning
        # ramble (the native stream usually separates it already — gated so we
        # don't add a latency round-trip to already-clean answers).
        if answer and _needs_format(answer):
            try:
                answer = _format_reply(answer) or answer
            except Exception:
                pass

        # Persist transcript (same as before): user + agent messages keyed by sid.
        now = time.time()
        try:
            _chat.save_message(sid, "user", message, ts=now)
            if answer:
                _chat.save_message(sid, "agent", answer, ts=now + 0.001)
        except Exception:
            pass

        if answer:
            yield (_json.dumps({"type": "answer", "text": answer}) + "\n").encode()
        yield (_json.dumps({"type": "done", "session_id": sid}) + "\n").encode()
    except Exception as exc:  # noqa: BLE001
        # Never leave the client hanging: surface the error and a done event.
        yield (_json.dumps({"type": "answer", "text": f"Error: {exc}"}) + "\n").encode()
        yield (_json.dumps({"type": "done", "session_id": sid}) + "\n").encode()


@router.post("/agent/chat")
def agent_chat(body: AgentChatIn):
    if not body.message.strip():
        raise HTTPException(400, "empty message")
    return StreamingResponse(
        _agent_stream(body.message, body.session_id),
        media_type="application/x-ndjson",
    )


@router.get("/agent/sessions")
def agent_sessions() -> dict[str, Any]:
    return {"sessions": _chat.list_sessions(tenant_id=_tenant())}


@router.get("/agent/sessions/{session_id}/messages")
def agent_session_messages(session_id: str) -> dict[str, Any]:
    return {"messages": _chat.get_messages(session_id, tenant_id=_tenant())}


@router.delete("/agent/sessions/{session_id}", status_code=204)
def agent_session_delete(session_id: str) -> None:
    _chat.delete_session(session_id, tenant_id=_tenant())
    # Evict the warm in-process agent so its memory is freed.
    try:
        _agent_runtime.drop_session(session_id)
    except Exception:
        pass
