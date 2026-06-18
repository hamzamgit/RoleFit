"""Apify REST client for RoleFit.

Uses httpx (a Hermes dependency) directly against api.apify.com — the apify-client
SDK is avoided due to an apify-shared version conflict. The token is read from the
APIFY_TOKEN env var (Hermes loads ~/.hermes/.env on startup); a direct .env read is
used as a fallback so CLI/tests work without the full agent boot.

Nothing here charges money on its own. Actor *runs* cost money, so `run_actor` is
only ever called after the main agent has shown a cost preview and the user has
approved (see the approval-gate principle in the RoleFit plan).
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Optional

import httpx

API = "https://api.apify.com/v2"


class ApifyError(RuntimeError):
    pass


class ApifyAuthError(ApifyError):
    pass


def get_token() -> str:
    tok = os.environ.get("APIFY_TOKEN")
    if tok:
        return tok.strip()
    # Fallback: read ~/.hermes/.env directly (token stored there, gitignored).
    env = Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))) / ".env"
    if env.is_file():
        for line in env.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.startswith("APIFY_TOKEN="):
                return line.split("=", 1)[1].strip()
    raise ApifyAuthError("APIFY_TOKEN not set (add it to ~/.hermes/.env)")


def _client(timeout: float = 30.0) -> httpx.Client:
    return httpx.Client(base_url=API, timeout=timeout)


def _params(extra: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    p = {"token": get_token()}
    if extra:
        p.update({k: v for k, v in extra.items() if v is not None})
    return p


def whoami() -> dict[str, Any]:
    with _client() as c:
        r = c.get("/users/me", params=_params())
    if r.status_code == 401:
        raise ApifyAuthError("Apify token rejected (401)")
    r.raise_for_status()
    d = r.json().get("data", {})
    return {
        "username": d.get("username"),
        "plan": (d.get("plan") or {}).get("id"),
        "email": d.get("email"),
    }


def _summarize_actor(a: dict[str, Any]) -> dict[str, Any]:
    stats = a.get("stats") or {}
    pricing = a.get("currentPricingInfo") or {}
    username = a.get("username") or (a.get("user") or {}).get("username")
    name = a.get("name")
    actor_id = f"{username}/{name}" if username and name else a.get("id")
    return {
        "actor_id": actor_id,
        "id": a.get("id"),
        "title": a.get("title") or name,
        "description": (a.get("description") or "")[:280],
        "username": username,
        "total_runs": stats.get("totalRuns"),
        "pricing_model": pricing.get("pricingModel"),
        "pricing": pricing,
        "url": f"https://apify.com/{actor_id}" if actor_id else None,
    }


def search_actors(query: str, *, limit: int = 8) -> list[dict[str, Any]]:
    """Search the Apify Store. Returns normalized actor summaries."""
    with _client() as c:
        r = c.get("/store", params=_params({"search": query, "limit": limit}))
    r.raise_for_status()
    items = r.json().get("data", {}).get("items", [])
    return [_summarize_actor(a) for a in items]


def get_actor(actor_id: str) -> dict[str, Any]:
    """Full actor detail. actor_id is 'username/name' or the actor's id."""
    aid = actor_id.replace("/", "~")  # Apify uses ~ as the path separator
    with _client() as c:
        r = c.get(f"/acts/{aid}", params=_params())
    if r.status_code == 404:
        raise ApifyError(f"actor not found: {actor_id}")
    r.raise_for_status()
    return r.json().get("data", {})


def get_input_schema(actor_id: str) -> dict[str, Any]:
    """Fetch an actor's input schema (field names, types, defaults) so the agent
    can build a correct filtered run input. Free."""
    aid = actor_id.replace("/", "~")
    with _client() as c:
        r = c.get(f"/acts/{aid}/builds/default", params=_params())
    r.raise_for_status()
    sch = (r.json().get("data") or {}).get("inputSchema")
    if isinstance(sch, str):
        import json as _json
        try:
            sch = _json.loads(sch)
        except Exception:
            return {}
    return sch or {}


def describe_pricing(actor: dict[str, Any]) -> str:
    """Human-readable cost line for an actor summary or detail dict."""
    pricing = actor.get("pricing") or actor.get("currentPricingInfo") or {}
    model = pricing.get("pricingModel") or "UNKNOWN"
    if model == "FREE":
        return "Free"
    if model == "PRICE_PER_DATASET_ITEM":
        amt = pricing.get("pricePerUnitUsd")
        return f"~${amt}/result" if amt is not None else "Pay per result"
    if model == "PAY_PER_EVENT":
        return "Pay per event (varies by actor events; see actor page)"
    if model in ("FLAT_PRICE_PER_MONTH", "PRICE_PER_MONTH"):
        amt = pricing.get("pricePerUnitUsd") or pricing.get("amount")
        return f"~${amt}/month rental" if amt is not None else "Monthly rental"
    return model


def list_user_runs(*, limit: int = 50, only_succeeded: bool = True) -> list[dict[str, Any]]:
    """List recent actor runs across ALL the user's actors (with dataset ids)."""
    params: dict[str, Any] = {"limit": limit, "desc": "true"}
    if only_succeeded:
        params["status"] = "SUCCEEDED"
    with _client() as c:
        r = c.get("/actor-runs", params=_params(params))
    r.raise_for_status()
    items = r.json().get("data", {}).get("items", [])
    out = []
    for it in items:
        stats = it.get("stats") or {}
        out.append({
            "run_id": it.get("id"),
            "actor_id": it.get("actId"),
            "dataset_id": it.get("defaultDatasetId"),
            "status": it.get("status"),
            "item_count": stats.get("datasetItemCount") or stats.get("outputBodyLen"),
            "finished_at": it.get("finishedAt"),
        })
    return out


def fetch_dataset(dataset_id: str, *, limit: int = 1000) -> list[dict[str, Any]]:
    """Read items from an existing dataset (FREE — no actor run)."""
    with _client() as c:
        r = c.get(f"/datasets/{dataset_id}/items", params=_params({"limit": limit}))
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, list) else data.get("items", [])


def run_actor(
    actor_id: str,
    run_input: dict[str, Any],
    *,
    max_items: Optional[int] = None,
    wait_secs: int = 120,
) -> dict[str, Any]:
    """Run an actor synchronously and return {run, items}.

    COSTS MONEY. Only call after an approved cost preview. `max_items` caps the
    dataset pulled back (it does not always cap actor billing — that depends on
    the actor's pricing model).
    """
    aid = actor_id.replace("/", "~")
    with _client(timeout=wait_secs + 30) as c:
        # run-sync-get-dataset-items returns dataset items directly once the run
        # finishes. NOTE: do NOT pass maxItems as a charge cap — Apify rejects runs
        # whose max charge falls below the $0.05/run minimum. Control count via the
        # actor's own input (maxRows etc.) and slice client-side below.
        r = c.post(
            f"/acts/{aid}/run-sync-get-dataset-items",
            params=_params({"timeout": wait_secs}),
            json=run_input,
        )
    if r.status_code == 401:
        raise ApifyAuthError("Apify token rejected (401)")
    if r.status_code == 404:
        raise ApifyError(f"actor not found: {actor_id}")
    if r.status_code >= 400:
        # surface Apify's real error message (e.g. "actor must be rented",
        # "input invalid: field X required") so the agent can report it, not flail
        msg = r.text[:400]
        try:
            err = r.json().get("error", {})
            msg = f"{err.get('type', '')}: {err.get('message', '')}".strip(": ") or msg
        except Exception:
            pass
        raise ApifyError(f"actor run failed ({r.status_code}): {msg}")
    body = r.json()
    items = body if isinstance(body, list) else body.get("items", [])
    if max_items is not None:
        items = items[:max_items]
    return {"items": items, "count": len(items)}
