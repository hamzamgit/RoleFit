"""Stage-1 match scoring — score each job-seeker against the (qualified) jobs.

For every (person, job) pair it produces a 0-100 match score, a one-line
rationale, and a skills-gap list, stored in the `analyses` table. Batched LLM
calls keep it cheap; only QUALIFIED jobs are scored (the company filter ran
first) so we never spend tokens on jobs the company rejected.
"""

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from . import applicants as _applicants
from . import db as _db
from . import llm as _llm

_SYSTEM = (
    "You are a precise technical recruiter scoring how well a candidate fits each "
    "job. For EACH numbered job return: a match SCORE 0-100, a one-line RATIONALE, a "
    "GAP list, and FOUR sub-criteria each with a 0-100 score + one-line evidence: "
    "role_alignment (does the role match the candidate's target/experience), "
    "seniority_fit, stack_coverage (tech/skill overlap), logistics (location/remote "
    "match). If the candidate gave preference feedback, honour it. "
    'Respond ONLY as JSON: {"scores":[{"n":1,"score":78,"rationale":"...","gap":["..."],'
    '"criteria":{"role_alignment":{"score":80,"evidence":"..."},'
    '"seniority_fit":{"score":75,"evidence":"..."},'
    '"stack_coverage":{"score":82,"evidence":"..."},'
    '"logistics":{"score":90,"evidence":"..."}}}, ...]}'
)


def _soul(slug: str) -> str:
    p = _db.hermes_home() / "profiles" / slug / "SOUL.md"
    if not p.is_file():
        return ""
    txt = p.read_text(encoding="utf-8", errors="replace")
    # drop the default persona template comment block
    if "agent's personality and tone" in txt:
        return ""
    return txt.strip()


def person_context(slug: str, *, tenant_id: str = _db.DEFAULT_TENANT) -> str:
    a = _applicants.get_applicant(slug, tenant_id=tenant_id) or {}
    parts = [f"Candidate: {slug}"]
    if a.get("tags"):
        parts.append("Tags/skills: " + ", ".join(a["tags"]))
    if a.get("target_roles"):
        parts.append("Target roles: " + ", ".join(a["target_roles"]))
    if a.get("locations"):
        parts.append("Locations: " + ", ".join(a["locations"]))
    bg = (a.get("background") or "").strip() or _soul(slug)
    if bg:
        parts.append("Background:\n" + bg)
    prefs = _learned_prefs(slug, tenant_id=tenant_id)
    if prefs:
        parts.append("\nLearned preferences (from past feedback — weight these):\n" + prefs)
    return "\n".join(parts)


def _learned_prefs(slug: str, *, tenant_id: str = _db.DEFAULT_TENANT) -> str:
    """Build a preference summary from the candidate's thumbs up/down feedback so
    scoring self-improves over time (no manual tuning)."""
    conn = _db.connect()
    rows = conn.execute(
        "SELECT j.title, j.company, a.feedback, a.feedback_note "
        "FROM analyses a JOIN jobs j ON j.id=a.job_id "
        "WHERE a.tenant_id=? AND a.person_id=? AND a.feedback IS NOT NULL "
        "ORDER BY a.updated_at DESC LIMIT 20",
        (tenant_id, slug),
    ).fetchall()
    liked, disliked = [], []
    for r in rows:
        tag = f"{r['title']} @ {r['company']}" + (f" ({r['feedback_note']})" if r["feedback_note"] else "")
        (liked if r["feedback"] == 1 else disliked).append(tag)
    out = []
    if liked:
        out.append("Liked / good fits: " + "; ".join(liked[:8]))
    if disliked:
        out.append("Disliked / poor fits (score similar ones lower): " + "; ".join(disliked[:8]))
    return "\n".join(out)


def has_background(slug: str, *, tenant_id: str = _db.DEFAULT_TENANT) -> bool:
    a = _applicants.get_applicant(slug, tenant_id=tenant_id) or {}
    return bool((a.get("background") or "").strip() or _soul(slug) or a.get("tags"))


def _job_brief(r: Any) -> str:
    desc = (r["description"] or "")[:600].replace("\n", " ")
    return (f"Title: {r['title']} | Company: {r['company']} | "
            f"Location: {r['location']} | {desc}")


def score_person(
    slug: str,
    *,
    tenant_id: str = _db.DEFAULT_TENANT,
    only_qualified: bool = True,
    rescore: bool = False,
    batch_size: int = 5,
) -> dict[str, Any]:
    """Score one person against jobs. Returns a summary."""
    ctx = person_context(slug, tenant_id=tenant_id)
    conn = _db.connect()

    sql = ("SELECT id, title, company, location, description FROM jobs WHERE tenant_id=?")
    params: list[Any] = [tenant_id]
    if only_qualified:
        sql += " AND qualified=1"
    if not rescore:
        sql += (" AND id NOT IN (SELECT job_id FROM analyses "
                "WHERE tenant_id=? AND person_id=?)")
        params += [tenant_id, slug]
    sql += " ORDER BY pulled_at DESC"
    rows = conn.execute(sql, params).fetchall()
    if not rows:
        return {"person": slug, "scored": 0, "note": "no jobs to score"}

    scored = 0
    now = time.time()
    for start in range(0, len(rows), batch_size):
        batch = rows[start : start + batch_size]
        listing = "\n".join(f"{i + 1}. {_job_brief(r)}" for i, r in enumerate(batch))
        user = f"CANDIDATE:\n{ctx}\n\nJOBS:\n{listing}"
        try:
            data = _llm.complete_json(_SYSTEM, user)
            verdicts = data.get("scores") if isinstance(data, dict) else data
        except Exception as e:
            return {"person": slug, "scored": scored, "error": f"LLM failed: {e}"}
        by_n = {}
        for v in verdicts or []:
            try:
                by_n[int(v.get("n"))] = v
            except Exception:
                continue
        for i, r in enumerate(batch):
            v = by_n.get(i + 1)
            if not v:
                continue
            try:
                score = max(0, min(100, int(v.get("score", 0))))
            except Exception:
                score = 0
            gap = v.get("gap") or []
            criteria = json.dumps(v.get("criteria") or {})
            conn.execute(
                """INSERT INTO analyses
                   (id, tenant_id, job_id, person_id, match_score, rationale,
                    gap_json, criteria_json, stage, status, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,1,'scored',?,?)
                   ON CONFLICT(job_id, person_id) DO UPDATE SET
                     match_score=excluded.match_score, rationale=excluded.rationale,
                     gap_json=excluded.gap_json, criteria_json=excluded.criteria_json,
                     updated_at=excluded.updated_at""",
                (str(uuid.uuid4()), tenant_id, r["id"], slug, score,
                 str(v.get("rationale", ""))[:400], json.dumps(gap), criteria, now, now),
            )
            scored += 1
        conn.commit()
    return {"person": slug, "scored": scored}


def score_all(*, tenant_id: str = _db.DEFAULT_TENANT, only_qualified: bool = True,
              rescore: bool = False) -> dict[str, Any]:
    """Score every job-seeker applicant against the jobs."""
    def _is_seeker(a: dict) -> bool:
        role = (a.get("role") or "").lower()
        if role == "job-seeker":
            return True
        if role in ("recruiter", "main-agent"):
            return False
        # no explicit role → infer from tags
        return any("seeker" in t.lower() for t in (a.get("tags") or []))

    seekers = [a for a in _applicants.list_applicants(tenant_id=tenant_id) if _is_seeker(a)]
    results = []
    for a in seekers:
        results.append(score_person(a["profile_slug"], tenant_id=tenant_id,
                                    only_qualified=only_qualified, rescore=rescore))
    return {"seekers": len(seekers), "results": results}


def list_matches(
    *,
    tenant_id: str = _db.DEFAULT_TENANT,
    person: Optional[str] = None,
    job_id: Optional[str] = None,
    min_score: Optional[int] = None,
    limit: int = 500,
) -> list[dict[str, Any]]:
    conn = _db.connect()
    sql = (
        "SELECT a.id, a.job_id, a.person_id, a.match_score, a.rationale, a.gap_json, "
        "a.criteria_json, a.feedback, a.feedback_note, "
        "a.stage, a.status, a.cv_path, a.cover_path, a.interview_path, a.learning_path, "
        "j.title, j.company, j.location, j.qualified "
        "FROM analyses a JOIN jobs j ON j.id=a.job_id "
        "WHERE a.tenant_id=?"
    )
    params: list[Any] = [tenant_id]
    if person:
        sql += " AND a.person_id=?"; params.append(person)
    if job_id:
        sql += " AND a.job_id=?"; params.append(job_id)
    if min_score is not None:
        sql += " AND a.match_score>=?"; params.append(min_score)
    sql += " ORDER BY a.match_score DESC LIMIT ?"
    params.append(limit)
    out = []
    for r in conn.execute(sql, params).fetchall():
        d = dict(r)
        d["gap"] = json.loads(d.pop("gap_json") or "[]")
        d["criteria"] = json.loads(d.pop("criteria_json") or "{}")
        out.append(d)
    return out


def set_feedback(person: str, job_id: str, feedback: int,
                 note: Optional[str] = None, *, tenant_id: str = _db.DEFAULT_TENANT) -> bool:
    """Record 👍 (1) / 👎 (-1) / clear (0) on a match — feeds back into future scoring."""
    conn = _db.connect()
    cur = conn.execute(
        "UPDATE analyses SET feedback=?, feedback_note=?, updated_at=? "
        "WHERE tenant_id=? AND job_id=? AND person_id=?",
        (feedback or None, note, time.time(), tenant_id, job_id, person),
    )
    conn.commit()
    return cur.rowcount > 0
