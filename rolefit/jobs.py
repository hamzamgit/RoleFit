"""Jobs read access — the shared company-wide pool pulled from Apify.

DESIGN: nothing about a job's shape is hardcoded. Different Apify actors return
different fields (Indeed has salary/benefits/descriptionText; LinkedIn differs).
We store the full raw item in `raw_json`; the only normalized columns are the
universal ones used for listing/search (title, company, location, url,
description). Everything else is dynamic:

- `discover_fields()` lists the actual fields present across pulled jobs (+ a
  sample value) so the MAIN AGENT can see what this actor returned.
- The agent picks which fields to surface via `set_display_fields()` (stored in
  `meta`); `list_jobs()` then returns those fields' values dynamically.
- Scoring agents read the WHOLE raw item (`job_context_for_scoring`) — no field
  is privileged.
"""

from __future__ import annotations

import json
import re
import time
import uuid
from typing import Any, Optional

from . import db as _db

_HTML_RE = re.compile(r"<[^>]*>|&#?[a-zA-Z0-9]+;")
# Block-level elements that should introduce paragraph breaks
_BLOCK_TAG_RE = re.compile(r"</?(?:p|div|li|h[1-6]|tr|br)\s*/?>", re.IGNORECASE)
# Common job description section headers — insert paragraph break before these
_SECTION_RE = re.compile(
    r"(?:(?<=\w\.)\s+)"  # sentence end + space
    r"("
    r"(?:Key\s+)?Responsibilities"
    r"|(?:Required|Preferred|Minimum|Nice.to.have)\s+Qualifications"
    r"|(?:What\s+You|What\s+We(?:.re|.ve)?|You\s+Will|You.ll)"
    r"|(?:About|Job\s+Summary|Benefits|Perks|Compensation|Salary)"
    r"|(?:Our\s+Mission|How\s+We\s+Work|The\s+Role|Role\s+Overview)"
    r"|(?:Education|Experience|Skills|Requirements)"
    r")\b",
    re.IGNORECASE,
)


def _strip_html(s: str) -> str:
    """Strip HTML tags and entities, preserving paragraph structure."""
    # Replace block-level tags with newlines (preserve structure)
    s = _BLOCK_TAG_RE.sub("\n", s)
    # Strip remaining inline HTML tags
    s = _HTML_RE.sub(" ", s)
    # Collapse whitespace but preserve paragraph breaks (double newlines)
    s = re.sub(r"[ \t]+", " ", s)            # collapse horizontal whitespace
    s = re.sub(r"\n{3,}", "\n\n", s)         # max 1 blank line between paragraphs
    s = re.sub(r" *\n *", "\n", s)           # strip spaces around newlines
    # For descriptions that are still one blob (no newlines at all), try to
    # detect section headers and insert paragraph breaks.
    if "\n" not in s:
        s = _SECTION_RE.sub(r".\n\n\1", s)
    return s.strip()

_DISPLAY_KEY = "jobs_display_fields"
# fields too noisy/structural to ever offer as display columns or scoring text
_HIDE = {"scrapingInfo", "descriptionHtml", "companyLogoUrl", "companyHeaderUrl"}


def _raw(r: Any) -> dict[str, Any]:
    try:
        return json.loads(r["raw_json"] or "{}")
    except Exception:
        return {}


def _flatten_sample(v: Any) -> Any:
    """A compact display value for an arbitrary field."""
    if isinstance(v, dict):
        for k in ("salaryText", "text", "name", "formattedAddress", "displayName"):
            if isinstance(v.get(k), str):
                return v[k]
        return json.dumps(v, default=str)[:120]
    if isinstance(v, list):
        flat = [x for x in (_flatten_sample(i) for i in v[:4]) if x is not None]
        return ", ".join(str(x) for x in flat)[:120]
    return v


# --- agent-chosen display fields ------------------------------------------

def get_display_fields(*, tenant_id: str = _db.DEFAULT_TENANT) -> list[str]:
    raw = _db.get_meta(_DISPLAY_KEY, tenant_id=tenant_id)
    return json.loads(raw) if raw else []


def set_display_fields(fields: list[str], *, tenant_id: str = _db.DEFAULT_TENANT) -> list[str]:
    clean = [f for f in fields if f and f not in _HIDE]
    _db.set_meta(_DISPLAY_KEY, json.dumps(clean), tenant_id=tenant_id)
    return clean


def discover_fields(*, tenant_id: str = _db.DEFAULT_TENANT, sample_size: int = 50) -> list[dict[str, Any]]:
    """Union of fields present in pulled jobs, with frequency + a sample value."""
    conn = _db.connect()
    rows = conn.execute(
        "SELECT raw_json FROM jobs WHERE tenant_id=? ORDER BY pulled_at DESC LIMIT ?",
        (tenant_id, sample_size),
    ).fetchall()
    total = len(rows) or 1
    stats: dict[str, dict[str, Any]] = {}
    for r in rows:
        for k, v in _raw(r).items():
            if k in _HIDE:
                continue
            s = stats.setdefault(k, {"field": k, "count": 0, "sample": None})
            s["count"] += 1
            if s["sample"] is None and v not in (None, "", [], {}):
                s["sample"] = _flatten_sample(v)
    out = sorted(stats.values(), key=lambda x: -x["count"])
    for s in out:
        s["present_pct"] = round(100 * s["count"] / total)
    return out


# --- listing ---------------------------------------------------------------

def _list_row(r: Any, display_fields: list[str]) -> dict[str, Any]:
    raw = _raw(r)
    desc = r["description"] or ""
    row = {
        "id": r["id"],
        "title": r["title"],
        "company": r["company"],
        "location": r["location"],
        "url": r["url"],
        "source": r["source"],
        "pulled_at": r["pulled_at"],
        "snippet": (desc[:280] + "…") if len(desc) > 280 else desc,
        "has_description": bool(desc),
        # company-requirements flag (set by the Requirement Agent)
        "qualified": r["qualified"],
        "qualify_reason": r["qualify_reason"],
        # dynamic, agent-chosen extra fields pulled straight from the raw item
        "extra": {f: _flatten_sample(raw.get(f)) for f in display_fields},
    }
    return row


def list_jobs(
    *,
    tenant_id: str = _db.DEFAULT_TENANT,
    limit: int = 100,
    offset: int = 0,
    search: Optional[str] = None,
    qualified: Optional[str] = None,  # 'yes' | 'no' | 'pending' | None(all)
) -> dict[str, Any]:
    conn = _db.connect()
    fields = get_display_fields(tenant_id=tenant_id)
    sql = (
        "SELECT id, title, company, location, url, source, pulled_at, "
        "description, raw_json, qualified, qualify_reason FROM jobs WHERE tenant_id=?"
    )
    params: list[Any] = [tenant_id]
    if search:
        sql += " AND (title LIKE ? OR company LIKE ? OR description LIKE ?)"
        like = f"%{search}%"
        params += [like, like, like]
    if qualified == "yes":
        sql += " AND qualified=1"
    elif qualified == "no":
        sql += " AND qualified=0"
    elif qualified == "pending":
        sql += " AND qualified IS NULL"
    sql += " ORDER BY pulled_at DESC LIMIT ? OFFSET ?"
    params += [limit, offset]
    rows = [_list_row(r, fields) for r in conn.execute(sql, params).fetchall()]
    return {"display_fields": fields, "jobs": rows}


def get_job(job_id: str, *, tenant_id: str = _db.DEFAULT_TENANT) -> Optional[dict[str, Any]]:
    conn = _db.connect()
    r = conn.execute(
        "SELECT * FROM jobs WHERE id=? AND tenant_id=?", (job_id, tenant_id)
    ).fetchone()
    if not r:
        return None
    raw = {k: v for k, v in _raw(r).items() if k not in _HIDE}
    keys = r.keys()
    try:
        trace = json.loads(r["qualify_trace"]) if ("qualify_trace" in keys and r["qualify_trace"]) else []
    except Exception:
        trace = []
    return {
        "id": r["id"], "title": r["title"], "company": r["company"],
        "location": r["location"], "url": r["url"], "source": r["source"],
        "pulled_at": r["pulled_at"], "description": r["description"],
        "qualified": (r["qualified"] if "qualified" in keys else None),
        "qualify_reason": (r["qualify_reason"] if "qualify_reason" in keys else None),
        "qualify_trace": trace,
        "fields": raw,  # everything the actor returned (minus structural noise)
    }


def job_context_for_scoring(job_id: str, *, tenant_id: str = _db.DEFAULT_TENANT) -> str:
    """Complete job text for a scoring agent — ALL fields, nothing privileged."""
    j = get_job(job_id, tenant_id=tenant_id)
    if not j:
        return ""
    lines = [f"Title: {j['title']}", f"Company: {j['company']}",
             f"Location: {j['location']}"]
    desc = j.get("description")
    for k, v in (j.get("fields") or {}).items():
        if k in ("title", "companyName", "location", "descriptionText"):
            continue
        val = _flatten_sample(v)
        if val not in (None, "", []):
            lines.append(f"{k}: {val}")
    if desc:
        lines.append("\nDescription:\n" + desc)
    return "\n".join(lines)


def count_jobs(*, tenant_id: str = _db.DEFAULT_TENANT) -> int:
    conn = _db.connect()
    return conn.execute(
        "SELECT COUNT(*) FROM jobs WHERE tenant_id=?", (tenant_id,)
    ).fetchone()[0]


# --- writing ---------------------------------------------------------------

def _scalar(v: Any) -> Any:
    """Coerce a scraped field to a SQLite-bindable scalar (text or None)."""
    if v is None or isinstance(v, (str, int, float)):
        return v
    if isinstance(v, dict):
        for k in ("formattedAddress", "name", "displayName", "text", "label"):
            if isinstance(v.get(k), str):
                return v[k]
        city = v.get("city")
        if isinstance(city, str):
            state = v.get("state") or v.get("region")
            return f"{city}, {state}" if isinstance(state, str) else city
    return json.dumps(v, default=str)[:500]


def ingest_items(items: list[dict[str, Any]], *, tenant_id: str = _db.DEFAULT_TENANT,
                 source: str = "apify") -> int:
    """Insert scraped job items into the shared jobs table (deduped). Returns rows added.

    Robust to any actor's shape — pass `items[:N]` to ingest only N.
    """
    conn = _db.connect()
    now = time.time()
    before = count_jobs(tenant_id=tenant_id)
    for it in items:
        if not isinstance(it, dict):
            continue
        ext = str(it.get("jobKey") or it.get("id") or it.get("jobId")
                  or it.get("url") or it.get("jobUrl") or uuid.uuid4())
        desc = it.get("descriptionText") or it.get("jobDescription") or it.get("description") or ""
        if not isinstance(desc, str):
            desc = json.dumps(desc, default=str)
        desc = _strip_html(desc)[:20000]
        try:
            conn.execute(
                """INSERT OR IGNORE INTO jobs
                   (id, tenant_id, source, external_id, title, company, location,
                    url, description, raw_json, pulled_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (str(uuid.uuid4()), tenant_id, source, ext,
                 _scalar(it.get("title") or it.get("positionName") or it.get("jobTitle")),
                 _scalar(it.get("companyName") or it.get("company")),
                 _scalar(it.get("location") or it.get("jobLocation")),
                 _scalar(it.get("url") or it.get("jobUrl") or it.get("link") or it.get("companyUrl")),
                 desc[:20000], json.dumps(it, default=str)[:60000], now),
            )
        except Exception:
            pass
    conn.commit()
    return count_jobs(tenant_id=tenant_id) - before
