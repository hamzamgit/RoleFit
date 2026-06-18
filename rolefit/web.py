"""Free web search (DuckDuckGo via `ddgs`) — no API key, no cost.

Used by the Requirement Agent to research a company's remote/location policy when
a job posting alone is ambiguous. Best-effort: returns "" on any failure so a
search outage never breaks flagging.
"""

from __future__ import annotations


def search(query: str, *, max_results: int = 4) -> str:
    """Return a compact text digest of the top results, or "" on failure."""
    try:
        from ddgs import DDGS

        rows = list(DDGS().text(query, max_results=max_results))
    except Exception:
        return ""
    out = []
    for r in rows:
        title = (r.get("title") or "").strip()
        body = (r.get("body") or "").strip()
        if title or body:
            out.append(f"- {title}: {body[:220]}")
    return "\n".join(out)
