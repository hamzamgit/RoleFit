"""Autonomous daily pipeline — runs the whole RoleFit flow end-to-end with no
manual steps, and builds a digest of what happened.

    pull (approved actor) → flag (Requirement Agent, +research) → score job-seekers
    → generate for strong matches → digest

Designed to be invoked by a Hermes cron job (see `rolefit-cli schedule-daily`).
Honours the approval gate: it only runs the PAID Apify pull if a config has been
approved; otherwise it works on whatever jobs are already in the pool.
"""

from __future__ import annotations

import json
from typing import Any, Optional

from . import db as _db
from . import requirements as _req
from . import scoring as _scoring
from . import generate as _generate


def _approved_config(tenant_id: str):
    r = _db.connect().execute(
        "SELECT actor_id, input_json, approved FROM apify_config WHERE tenant_id=? "
        "ORDER BY updated_at DESC LIMIT 1", (tenant_id,)
    ).fetchone()
    return dict(r) if r else None


def run_daily(
    *,
    tenant_id: str = _db.DEFAULT_TENANT,
    pull: bool = True,
    research: bool = True,
    generate_min: int = 80,
    max_items: int = 50,
) -> dict[str, Any]:
    """Run the full pipeline. Returns a structured summary + a markdown digest."""
    steps: dict[str, Any] = {}

    # 1. Pull (only if an approved config exists — respects the money gate)
    if pull:
        cfg = _approved_config(tenant_id)
        if cfg and cfg.get("approved"):
            from . import apify as _apify
            from . import jobs as _jobs
            try:
                res = _apify.run_actor(cfg["actor_id"],
                                       json.loads(cfg["input_json"] or "{}"),
                                       max_items=max_items)
                added = _jobs.ingest_items(res["items"], tenant_id=tenant_id)
                steps["pull"] = {"actor": cfg["actor_id"], "added": added}
            except Exception as e:
                steps["pull"] = {"error": str(e)[:200]}
        else:
            steps["pull"] = {"skipped": "no approved actor config"}

    # 2. Requirement filter (only if requirements set)
    if _req.get_requirements(tenant_id=tenant_id):
        steps["filter"] = _req.evaluate_jobs(tenant_id=tenant_id, only_unflagged=True,
                                             research=research)

    # 3. Score job-seekers vs qualified jobs
    steps["score"] = _scoring.score_all(tenant_id=tenant_id, only_qualified=True)

    # 4. Generate for strong matches
    gen = []
    seekers = {r["person"] for r in steps["score"].get("results", [])}
    for slug in seekers:
        gen.append(_generate.generate_for_matches(slug, tenant_id=tenant_id,
                                                  min_score=generate_min))
    steps["generate"] = {"people": len(gen),
                         "generated": sum(g.get("count", 0) for g in gen)}

    return {"steps": steps, "digest": _digest(tenant_id, steps, generate_min)}


def _digest(tenant_id: str, steps: dict[str, Any], gen_min: int) -> str:
    qc = _req.counts(tenant_id=tenant_id)
    lines = ["# RoleFit daily digest", ""]
    p = steps.get("pull") or {}
    if "added" in p:
        lines.append(f"- Pulled **{p['added']}** new jobs from `{p.get('actor')}`")
    f = steps.get("filter") or {}
    if "qualified" in f:
        lines.append(f"- Requirement filter: **{f['qualified']}** qualified, "
                     f"{f.get('disqualified', 0)} disqualified ({f.get('researched', 0)} web-researched)")
    lines.append(f"- Job pool: {qc['total']} total · {qc['qualified']} qualified")
    lines.append("")
    # top matches per person
    for r in (steps.get("score") or {}).get("results", []):
        slug = r.get("person")
        if not slug:
            continue
        top = _scoring.list_matches(tenant_id=tenant_id, person=slug, min_score=gen_min, limit=5)
        lines.append(f"## {slug} — {len(top)} strong match(es) ≥{gen_min}")
        for m in top:
            lines.append(f"- **{m['match_score']}** · {m['title']} @ {m['company']} "
                         f"({m['location']}) — _{m['rationale'][:80]}_")
        if not top:
            lines.append("- _no strong matches today_")
        lines.append("")
    g = steps.get("generate") or {}
    lines.append(f"_Generated application kits for {g.get('generated', 0)} strong matches._")
    return "\n".join(lines)
