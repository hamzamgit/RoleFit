"""Company-requirements filter — the "requirement agent".

The company defines its hard rules in plain English (e.g. "Remote roles only, the
candidate must be able to work from the USA; software engineering positions"). As
jobs arrive, this evaluator flags each one **qualify / disqualify** against those
rules with a short reason, so per-person matching later only runs on jobs the
company actually cares about.

It's an LLM classifier (batched for cost), not a chat — it runs automatically.
"""

from __future__ import annotations

import json
from typing import Any, Optional

from . import db as _db
from . import llm as _llm
from . import web as _web

_REQ_KEY = "company_requirements"

_SYSTEM = (
    "You are a strict job-screening filter for a company. You are given the "
    "company's hard requirements and a numbered list of jobs. For EACH job decide "
    "if it QUALIFIES (meets the requirements) or is DISQUALIFIED. Judge only on the "
    "company's stated rules — location/remote, role type, seniority, etc. Also rate "
    "your CONFIDENCE: 'high' if the posting clearly settles every rule, 'low' if you "
    "had to guess on any rule (e.g. remote/location unclear). "
    'Respond with ONLY a JSON object: {"verdicts":[{"n":1,"qualified":true,'
    '"confidence":"high","reason":"short reason"}, ...]} — one per job, reason <15 words.'
)

_RESEARCH_SYSTEM = (
    "You are a job-screening filter. Given the company requirements, a job posting, "
    "and web-research notes about the company/role, give a FINAL verdict. "
    'Respond with ONLY JSON: {"qualified":true,"reason":"short reason citing the research"}.'
)


def get_requirements(*, tenant_id: str = _db.DEFAULT_TENANT) -> str:
    return _db.get_meta(_REQ_KEY, tenant_id=tenant_id, default="") or ""


def set_requirements(text: str, *, tenant_id: str = _db.DEFAULT_TENANT) -> str:
    _db.set_meta(_REQ_KEY, text.strip(), tenant_id=tenant_id)
    return get_requirements(tenant_id=tenant_id)


def _job_brief(r: Any) -> str:
    raw = {}
    try:
        raw = json.loads(r["raw_json"] or "{}")
    except Exception:
        pass
    loc = r["location"] or raw.get("location") or "?"
    rem = raw.get("remote") or raw.get("workType") or raw.get("isRemote")
    etype = raw.get("jobType") or raw.get("employmentType")
    desc = (r["description"] or "")[:240].replace("\n", " ")
    parts = [f"Title: {r['title']}", f"Company: {r['company']}", f"Location: {loc}"]
    if rem:
        parts.append(f"Remote: {rem}")
    if etype:
        parts.append(f"Type: {etype}")
    if desc:
        parts.append(f"Snippet: {desc}")
    return " | ".join(str(p) for p in parts)


def _research_verdict(requirements: str, brief: str, company: str, title: str):
    """Free web research → (verdict|None, query, notes) for one ambiguous job."""
    query = f"{company} {title} remote work location policy hiring"
    notes = _web.search(query)
    if not notes:
        query = f"{company} careers remote OR onsite"
        notes = _web.search(query)
    if not notes:
        return None, query, ""
    user = (f"COMPANY REQUIREMENTS:\n{requirements}\n\nJOB:\n{brief}\n\n"
            f"WEB RESEARCH NOTES:\n{notes}")
    try:
        v = _llm.complete_json(_RESEARCH_SYSTEM, user)
        v = v if isinstance(v, dict) and "qualified" in v else None
    except Exception:
        v = None
    return v, query, notes


def evaluate_jobs(
    *,
    tenant_id: str = _db.DEFAULT_TENANT,
    only_unflagged: bool = True,
    batch_size: int = 12,
    limit: Optional[int] = None,
    research: bool = False,
    research_cap: int = 15,
) -> dict[str, Any]:
    """Flag jobs qualify/disqualify against the company requirements. Returns a summary.

    When research=True, any job the model was NOT confident about gets a free
    DuckDuckGo research pass (company remote/location policy) and a final re-verdict.
    """
    requirements = get_requirements(tenant_id=tenant_id)
    if not requirements:
        return {"evaluated": 0, "error": "no company requirements set"}

    conn = _db.connect()
    sql = "SELECT id, title, company, location, description, raw_json FROM jobs WHERE tenant_id=?"
    params: list[Any] = [tenant_id]
    if only_unflagged:
        sql += " AND qualified IS NULL"
    sql += " ORDER BY pulled_at DESC"
    if limit:
        sql += f" LIMIT {int(limit)}"
    rows = conn.execute(sql, params).fetchall()
    if not rows:
        return {"evaluated": 0, "qualified": 0, "disqualified": 0}

    evaluated = qualified = disqualified = researched = 0
    research_budget = research_cap
    for start in range(0, len(rows), batch_size):
        batch = rows[start : start + batch_size]
        listing = "\n".join(f"{i + 1}. {_job_brief(r)}" for i, r in enumerate(batch))
        user = f"COMPANY REQUIREMENTS:\n{requirements}\n\nJOBS:\n{listing}"
        try:
            data = _llm.complete_json(_SYSTEM, user)
            verdicts = data.get("verdicts") if isinstance(data, dict) else data
        except Exception as e:
            return {"evaluated": evaluated, "error": f"LLM eval failed: {e}",
                    "qualified": qualified, "disqualified": disqualified}
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
            q = 1 if v.get("qualified") else 0
            conf = str(v.get("confidence", "")).lower() or "unknown"
            reason = str(v.get("reason", ""))[:300]
            trace: list[dict[str, Any]] = [{
                "step": "screen",
                "title": "Checked against company requirements",
                "verdict": "qualified" if q else "disqualified",
                "confidence": conf,
                "detail": reason,
            }]
            # research pass for low-confidence verdicts
            if (research and research_budget > 0 and conf != "high"):
                research_budget -= 1
                rv, query, notes = _research_verdict(
                    requirements, _job_brief(r), r["company"], r["title"])
                step = {"step": "research", "title": "Web-researched the company",
                        "query": query, "found": (notes or "(no results)")[:600]}
                if rv is not None:
                    researched += 1
                    q = 1 if rv.get("qualified") else 0
                    reason = str(rv.get("reason", ""))[:300]
                    step["verdict"] = "qualified" if q else "disqualified"
                trace.append(step)
                trace.append({
                    "step": "final",
                    "title": "Final verdict (after research)",
                    "verdict": "qualified" if q else "disqualified",
                    "detail": reason,
                })
            conn.execute(
                "UPDATE jobs SET qualified=?, qualify_reason=?, qualify_trace=? "
                "WHERE id=? AND tenant_id=?",
                (q, reason, json.dumps(trace), r["id"], tenant_id),
            )
            evaluated += 1
            qualified += q
            disqualified += 1 - q
        conn.commit()

    return {"evaluated": evaluated, "qualified": qualified,
            "disqualified": disqualified, "researched": researched}


def counts(*, tenant_id: str = _db.DEFAULT_TENANT) -> dict[str, int]:
    conn = _db.connect()

    def c(where: str) -> int:
        return conn.execute(
            f"SELECT COUNT(*) FROM jobs WHERE tenant_id=? AND {where}", (tenant_id,)
        ).fetchone()[0]

    return {
        "total": c("1=1"),
        "qualified": c("qualified=1"),
        "disqualified": c("qualified=0"),
        "unevaluated": c("qualified IS NULL"),
    }
