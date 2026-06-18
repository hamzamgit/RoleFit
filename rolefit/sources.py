"""Free job sources — pull jobs without paying Apify.

Each adapter fetches public listings and normalizes them into the same item shape
`jobs.ingest_items` expects (title/company/location/url/description + raw). All
free, no API key.

Adapters:
- remoteok   : RemoteOK public JSON feed (broad remote roles)
- greenhouse : a company's Greenhouse board (boards-api.greenhouse.io)
- lever      : a company's Lever board (api.lever.co)
"""

from __future__ import annotations

import re
from typing import Any, Optional

import httpx

from . import db as _db
from . import jobs as _jobs

_UA = {"User-Agent": "RoleFit/1.0 (+job-aggregator)"}
_TAG = re.compile(r"<[^>]+>")


def _strip(html: str) -> str:
    return " ".join(_TAG.sub(" ", html or "").split())


def remoteok(search: Optional[str] = None, *, limit: int = 100) -> list[dict[str, Any]]:
    r = httpx.get("https://remoteok.com/api", headers=_UA, timeout=30)
    r.raise_for_status()
    data = r.json()
    items = []
    for j in data:
        if not isinstance(j, dict) or not j.get("position"):
            continue  # first element is legal/metadata
        title = j.get("position")
        if search and search.lower() not in (title + " " + " ".join(j.get("tags", []))).lower():
            continue
        items.append({
            "id": str(j.get("id") or j.get("slug") or j.get("url")),
            "title": title,
            "companyName": j.get("company"),
            "location": j.get("location") or "Remote",
            "url": j.get("url") or j.get("apply_url"),
            "descriptionText": _strip(j.get("description", "")),
            "tags": j.get("tags"),
            "salary": j.get("salary_min") and f"${j.get('salary_min')}-${j.get('salary_max')}",
            "source": "remoteok",
        })
        if len(items) >= limit:
            break
    return items


def greenhouse(company: str, *, limit: int = 200) -> list[dict[str, Any]]:
    """company = the board token, e.g. 'stripe' for boards.greenhouse.io/stripe."""
    url = f"https://boards-api.greenhouse.io/v1/boards/{company}/jobs?content=true"
    r = httpx.get(url, headers=_UA, timeout=30)
    r.raise_for_status()
    out = []
    for j in r.json().get("jobs", [])[:limit]:
        out.append({
            "id": str(j.get("id")),
            "title": j.get("title"),
            "companyName": company,
            "location": (j.get("location") or {}).get("name"),
            "url": j.get("absolute_url"),
            "descriptionText": _strip(j.get("content", "")),
            "source": "greenhouse",
        })
    return out


def lever(company: str, *, limit: int = 200) -> list[dict[str, Any]]:
    r = httpx.get(f"https://api.lever.co/v0/postings/{company}?mode=json",
                  headers=_UA, timeout=30)
    r.raise_for_status()
    out = []
    for j in r.json()[:limit]:
        out.append({
            "id": str(j.get("id")),
            "title": j.get("text"),
            "companyName": company,
            "location": (j.get("categories") or {}).get("location"),
            "url": j.get("hostedUrl"),
            "descriptionText": _strip(j.get("descriptionPlain") or j.get("description", "")),
            "source": "lever",
        })
    return out


_ADAPTERS = {"remoteok": remoteok, "greenhouse": greenhouse, "lever": lever}


def pull(source: str, *, tenant_id: str = _db.DEFAULT_TENANT, **kw: Any) -> dict[str, Any]:
    """Fetch from a free source and ingest into jobs (deduped). FREE."""
    fn = _ADAPTERS.get(source)
    if not fn:
        return {"error": f"unknown source {source}; have {list(_ADAPTERS)}"}
    try:
        items = fn(**kw)
    except Exception as e:
        return {"source": source, "error": str(e)[:200]}
    added = _jobs.ingest_items(items, tenant_id=tenant_id, source=source)
    # auto-flag new jobs if requirements are set
    try:
        from . import requirements as _req
        if added and _req.get_requirements(tenant_id=tenant_id):
            _req.evaluate_jobs(tenant_id=tenant_id, only_unflagged=True)
    except Exception:
        pass
    return {"source": source, "fetched": len(items), "added": added,
            "total": _jobs.count_jobs(tenant_id=tenant_id)}
