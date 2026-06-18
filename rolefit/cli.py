"""RoleFit CLI — the surface the main agent drives (via the terminal tool) to set
up and run the daily Apify job pull.

Design: deterministic subcommands with JSON output so the agent can parse results.
Anything that costs money (`run-pull`) requires an explicit `--confirm` flag — the
agent must show the cost preview and get the user's OK first (approval gate).

Usage:
    python -m rolefit.cli applicants
    python -m rolefit.cli apify-search "linkedin jobs remote"
    python -m rolefit.cli apify-pricing curious_coder/linkedin-jobs-scraper
    python -m rolefit.cli pull-config --actor curious_coder/linkedin-jobs-scraper --input '{"queries":["python"]}'
    python -m rolefit.cli run-pull --confirm
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import uuid
from typing import Any

from . import apify as _apify
from . import applicants as _applicants
from . import db as _db
from . import jobs as _jobs
from . import requirements as _req
from . import scoring as _scoring
from . import generate as _generate
from . import pipeline as _pipeline
from . import sources as _sources
from . import applications as _applications


def _out(obj: Any) -> None:
    print(json.dumps(obj, indent=2, default=str))


def _ingest_items(conn: Any, items: list[dict[str, Any]]) -> int:
    """Insert scraped job items into the shared jobs table. Returns rows added.

    Auto-runs the company-requirements filter on the newly-arrived jobs (only if
    requirements are set) so every job lands pre-flagged qualify/disqualify.
    """
    added = _jobs.ingest_items(items)
    if added and _req.get_requirements():
        try:
            _req.evaluate_jobs(only_unflagged=True)
        except Exception:
            pass
    return added


# --- applicants / tags -----------------------------------------------------

def cmd_applicants(args: argparse.Namespace) -> int:
    _out({"applicants": _applicants.list_applicants()})
    return 0


def cmd_tag(args: argparse.Namespace) -> int:
    a = _applicants.get_applicant(args.slug) or {}
    tags = set(a.get("tags") or [])
    tags.update(args.add or [])
    tags.difference_update(args.remove or [])
    _out(_applicants.upsert_applicant(args.slug, tags=sorted(tags)))
    return 0


def cmd_set_role(args: argparse.Namespace) -> int:
    """Agent writes its inferred role for a profile (job-seeker / recruiter / …)."""
    _out(_applicants.upsert_applicant(args.slug, role=args.role))
    return 0


def cmd_set_background(args: argparse.Namespace) -> int:
    """Set a person's described background (experience/skills) for matching + CV gen."""
    a = _applicants.upsert_applicant(args.slug, background=args.text)
    _out({"profile_slug": a["profile_slug"], "background_chars": len(args.text)})
    return 0


def cmd_score(args: argparse.Namespace) -> int:
    """Stage-1 match scoring: score job-seeker(s) against qualified jobs."""
    if args.person:
        _out(_scoring.score_person(args.person, only_qualified=not args.all_jobs,
                                   rescore=args.rescore))
    else:
        _out(_scoring.score_all(only_qualified=not args.all_jobs, rescore=args.rescore))
    return 0


def cmd_matches(args: argparse.Namespace) -> int:
    """List match results (analyses) sorted by score."""
    _out({"matches": _scoring.list_matches(person=args.person, min_score=args.min_score,
                                           limit=args.limit)})
    return 0


def cmd_generate(args: argparse.Namespace) -> int:
    """Generate CV/cover/interview/learning for a (person, job) match."""
    what = args.what.split(",") if args.what else None
    if args.job:
        _out(_generate.generate(args.person, args.job, what=what))
    else:
        _out(_generate.generate_for_matches(args.person, min_score=args.min_score))
    return 0


# --- apify discovery (free) ------------------------------------------------

def cmd_apify_search(args: argparse.Namespace) -> int:
    acts = _apify.search_actors(args.query, limit=args.limit)
    _out([
        {
            "actor_id": a["actor_id"],
            "title": a["title"],
            "total_runs": a["total_runs"],
            "pricing": _apify.describe_pricing(a),
            "url": a["url"],
            "description": a["description"],
        }
        for a in acts
    ])
    return 0


def cmd_apify_schema(args: argparse.Namespace) -> int:
    """Show an actor's input fields so the agent can build filtered input."""
    sch = _apify.get_input_schema(args.actor_id)
    props = sch.get("properties", {}) if isinstance(sch, dict) else {}
    fields = {
        k: {
            "type": v.get("type"),
            "title": v.get("title"),
            "enum": v.get("enum"),
            "default": v.get("default"),
            "example": v.get("prefill") or v.get("example"),
        }
        for k, v in props.items()
    }
    _out({"actor_id": args.actor_id, "required": sch.get("required", []), "fields": fields})
    return 0


def cmd_apify_pricing(args: argparse.Namespace) -> int:
    det = _apify.get_actor(args.actor_id)
    pricing = det.get("currentPricingInfo") or {}
    _out({
        "actor_id": args.actor_id,
        "title": det.get("title"),
        "pricing_model": pricing.get("pricingModel"),
        "pricing": pricing,
        "summary": _apify.describe_pricing({"pricing": pricing}),
    })
    return 0


# --- pull config (stored, approved) ----------------------------------------

def cmd_pull_config(args: argparse.Namespace) -> int:
    conn = _db.connect()
    try:
        run_input = json.loads(args.input) if args.input else {}
    except json.JSONDecodeError as e:
        print(f"invalid --input JSON: {e}", file=sys.stderr)
        return 2
    now = time.time()
    cid = str(uuid.uuid4())
    # one config per tenant for the MVP: replace any existing
    conn.execute("DELETE FROM apify_config WHERE tenant_id=?", (_db.DEFAULT_TENANT,))
    conn.execute(
        """INSERT INTO apify_config
           (id, tenant_id, actor_id, actor_name, input_json, cost_estimate,
            approved, schedule, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (cid, _db.DEFAULT_TENANT, args.actor, args.actor,
         json.dumps(run_input), args.cost, 1 if args.approved else 0,
         args.schedule, now, now),
    )
    conn.commit()
    _out({"saved": True, "config_id": cid, "actor": args.actor,
          "approved": bool(args.approved), "schedule": args.schedule})
    return 0


def cmd_show_config(args: argparse.Namespace) -> int:
    conn = _db.connect()
    r = conn.execute(
        "SELECT * FROM apify_config WHERE tenant_id=? ORDER BY updated_at DESC LIMIT 1",
        (_db.DEFAULT_TENANT,),
    ).fetchone()
    _out(dict(r) if r else None)
    return 0


# --- run pull (COSTS MONEY → requires --confirm) ---------------------------

def cmd_run_pull(args: argparse.Namespace) -> int:
    conn = _db.connect()
    r = conn.execute(
        "SELECT * FROM apify_config WHERE tenant_id=? ORDER BY updated_at DESC LIMIT 1",
        (_db.DEFAULT_TENANT,),
    ).fetchone()
    if not r:
        print("no apify_config saved — run pull-config first", file=sys.stderr)
        return 2
    cfg = dict(r)
    if not args.confirm:
        print(json.dumps({
            "would_run": True,
            "actor": cfg["actor_id"],
            "input": json.loads(cfg["input_json"] or "{}"),
            "note": "COSTS MONEY. Re-run with --confirm after user approval.",
        }, indent=2))
        return 0

    if os.environ.get("ROLEFIT_BLOCK_PAID") == "1":
        print(json.dumps({
            "blocked": True,
            "reason": "ROLEFIT_BLOCK_PAID=1 — paid Apify runs are disabled (demo/safe mode).",
        }, indent=2))
        return 0

    run_input = json.loads(cfg["input_json"] or "{}")
    try:
        result = _apify.run_actor(cfg["actor_id"], run_input, max_items=args.max_items)
    except _apify.ApifyError as e:
        _out({
            "ran": False,
            "actor": cfg["actor_id"],
            "error": str(e),
            "hint": "This actor may need renting or different input. Try a different "
                    "actor (e.g. borderline/indeed-scraper works without renting). "
                    "Do NOT modify code — pick another actor and re-run pull-config.",
        })
        return 0
    items = result["items"]
    added = _ingest_items(conn, items)
    _out({"ran": True, "actor": cfg["actor_id"], "items_pulled": len(items),
          "jobs_added": added,
          "jobs_table_total": conn.execute(
              "SELECT COUNT(*) FROM jobs WHERE tenant_id=?", (_db.DEFAULT_TENANT,)
          ).fetchone()[0]})
    return 0


def cmd_apify_runs(args: argparse.Namespace) -> int:
    """List recent successful runs across all the user's Apify actors (free)."""
    _out({"runs": _apify.list_user_runs(limit=args.limit)})
    return 0


def cmd_import_all(args: argparse.Namespace) -> int:
    """Import datasets from ALL recent successful runs into jobs (FREE, dedup)."""
    conn = _db.connect()
    runs = _apify.list_user_runs(limit=args.limit)
    total_added = 0
    seen_ds: set[str] = set()
    detail = []
    for run in runs:
        ds = run.get("dataset_id")
        if not ds or ds in seen_ds:
            continue
        seen_ds.add(ds)
        try:
            items = _apify.fetch_dataset(ds, limit=args.max_per_dataset)
            added = _ingest_items(conn, items)
            total_added += added
            detail.append({"actor": run.get("actor_id"), "dataset": ds,
                           "fetched": len(items), "added": added})
        except Exception as e:
            detail.append({"dataset": ds, "error": str(e)[:160]})
    _out({
        "datasets_processed": len(seen_ds),
        "jobs_added": total_added,
        "jobs_table_total": conn.execute(
            "SELECT COUNT(*) FROM jobs WHERE tenant_id=?", (_db.DEFAULT_TENANT,)
        ).fetchone()[0],
        "detail": detail,
    })
    return 0


def cmd_import_dataset(args: argparse.Namespace) -> int:
    """Ingest an existing Apify dataset into jobs (FREE — re-uses a paid run)."""
    conn = _db.connect()
    items = _apify.fetch_dataset(args.dataset, limit=args.limit)
    added = _ingest_items(conn, items)
    _out({"dataset": args.dataset, "items_fetched": len(items), "jobs_added": added,
          "jobs_table_total": conn.execute(
              "SELECT COUNT(*) FROM jobs WHERE tenant_id=?", (_db.DEFAULT_TENANT,)
          ).fetchone()[0]})
    return 0


def cmd_job_fields(args: argparse.Namespace) -> int:
    """List the actual fields the pulled jobs contain (dynamic, per actor)."""
    _out({
        "available_fields": _jobs.discover_fields(),
        "currently_displayed": _jobs.get_display_fields(),
    })
    return 0


def cmd_set_job_fields(args: argparse.Namespace) -> int:
    """Agent chooses which discovered fields to surface in the Jobs view."""
    _out({"display_fields": _jobs.set_display_fields(args.fields)})
    return 0


def cmd_set_requirements(args: argparse.Namespace) -> int:
    """Set the company's hard requirements (plain English)."""
    _out({"requirements": _req.set_requirements(args.text)})
    return 0


def cmd_show_requirements(args: argparse.Namespace) -> int:
    _out({"requirements": _req.get_requirements(), "counts": _req.counts()})
    return 0


def cmd_evaluate_jobs(args: argparse.Namespace) -> int:
    """Flag jobs qualify/disqualify against the company requirements."""
    _out(_req.evaluate_jobs(only_unflagged=not args.all, research=args.research))
    return 0


def cmd_feedback(args: argparse.Namespace) -> int:
    """Thumbs up/down a match — feeds future scoring (self-improvement)."""
    ok = _scoring.set_feedback(args.person, args.job, args.score, note=args.note)
    _out({"updated": ok, "person": args.person, "feedback": args.score})
    return 0


def cmd_track(args: argparse.Namespace) -> int:
    """Add a match to the application tracker (or auto-shortlist strong matches)."""
    if args.job:
        _out(_applications.add(args.person, args.job, status=args.status))
    else:
        n = _applications.add_strong_matches(args.person, min_score=args.min_score)
        _out({"person": args.person, "shortlisted": n})
    return 0


def cmd_app_move(args: argparse.Namespace) -> int:
    _out({"moved": _applications.move(args.id, args.status)})
    return 0


def cmd_applications(args: argparse.Namespace) -> int:
    _out({"board": _applications.board(person=args.person)})
    return 0


def cmd_pull_source(args: argparse.Namespace) -> int:
    """Pull jobs from a FREE source (remoteok/greenhouse/lever) — no Apify cost."""
    kw: dict = {}
    if args.search:
        kw["search"] = args.search
    if args.company:
        kw["company"] = args.company
    _out(_sources.pull(args.source, **kw))
    return 0


def cmd_run_daily(args: argparse.Namespace) -> int:
    """Autonomous full pipeline: pull → flag → score → generate → digest."""
    res = _pipeline.run_daily(pull=not args.no_pull, research=not args.no_research,
                              generate_min=args.generate_min)
    if args.digest:
        print(res["digest"])
    else:
        _out(res)
    return 0


def cmd_schedule_daily(args: argparse.Namespace) -> int:
    """Register a Hermes cron job that runs the daily pipeline + delivers the digest."""
    import os
    from cron.jobs import create_job

    scripts = _db.hermes_home() / "scripts"
    scripts.mkdir(parents=True, exist_ok=True)
    wrapper = scripts / "rolefit_daily.sh"
    repo = str(Path(__file__).resolve().parent.parent)
    wrapper.write_text(
        f"#!/usr/bin/env bash\ncd {repo}\n{repo}/rolefit-cli run-daily --digest\n",
        encoding="utf-8",
    )
    os.chmod(wrapper, 0o755)
    job = create_job(
        prompt=None, schedule=args.schedule, name="rolefit-daily",
        script="rolefit_daily.sh", no_agent=True,
        deliver=args.deliver, workdir=repo,
    )
    _out({"scheduled": True, "job_id": job.get("id"), "schedule": args.schedule,
          "deliver": args.deliver, "script": str(wrapper)})
    return 0


def cmd_stats(args: argparse.Namespace) -> int:
    """Quick system state — so the agent never needs to inspect code/DB."""
    conn = _db.connect()
    t = _db.DEFAULT_TENANT

    def _count(sql):
        return conn.execute(sql, (t,)).fetchone()[0]

    cfg = conn.execute(
        "SELECT actor_id FROM apify_config WHERE tenant_id=? ORDER BY updated_at DESC LIMIT 1",
        (t,),
    ).fetchone()
    _out({
        "jobs": _count("SELECT COUNT(*) FROM jobs WHERE tenant_id=?"),
        "applicants": _count("SELECT COUNT(*) FROM applicants WHERE tenant_id=?"),
        "analyses": _count("SELECT COUNT(*) FROM analyses WHERE tenant_id=?"),
        "pinned_actor": cfg["actor_id"] if cfg else None,
        "display_fields": _jobs.get_display_fields(),
    })
    return 0


def cmd_clear_jobs(args: argparse.Namespace) -> int:
    """Delete all jobs from the shared pool (destructive)."""
    conn = _db.connect()
    before = conn.execute(
        "SELECT COUNT(*) FROM jobs WHERE tenant_id=?", (_db.DEFAULT_TENANT,)
    ).fetchone()[0]
    conn.execute("DELETE FROM jobs WHERE tenant_id=?", (_db.DEFAULT_TENANT,))
    conn.commit()
    _out({"cleared": before, "jobs_remaining": 0})
    return 0


def cmd_dedup(args: argparse.Namespace) -> int:
    """Remove duplicate jobs (same title+company), keeping the earliest."""
    conn = _db.connect()
    before = conn.execute(
        "SELECT COUNT(*) FROM jobs WHERE tenant_id=?", (_db.DEFAULT_TENANT,)
    ).fetchone()[0]
    conn.execute(
        """DELETE FROM jobs WHERE tenant_id=? AND rowid NOT IN (
               SELECT MIN(rowid) FROM jobs WHERE tenant_id=?
               GROUP BY LOWER(COALESCE(title,'')), LOWER(COALESCE(company,''))
           )""",
        (_db.DEFAULT_TENANT, _db.DEFAULT_TENANT),
    )
    conn.commit()
    after = conn.execute(
        "SELECT COUNT(*) FROM jobs WHERE tenant_id=?", (_db.DEFAULT_TENANT,)
    ).fetchone()[0]
    _out({"before": before, "after": after, "removed": before - after})
    return 0


def cmd_jobs(args: argparse.Namespace) -> int:
    """List jobs with display fields as columns — rich terminal table."""
    result = _jobs.list_jobs(limit=args.limit)
    fields = result["display_fields"]
    rows = result["jobs"]

    if not rows:
        _out({"jobs": [], "columns": ["title", "company", "location"], "count": 0})
        return 0

    # Build table: fixed columns + display fields
    cols = ["#", "title", "company", "location"] + fields
    # Width for each column (capped)
    widths = {c: len(c) for c in cols}
    for i, r in enumerate(rows):
        widths["title"] = min(max(widths["title"], len(r["title"] or "")), 35)
        widths["company"] = min(max(widths["company"], len(r["company"] or "")), 30)
        widths["location"] = min(max(widths["location"], len(r["location"] or "")), 25)
        for c in fields:
            val = str(r.get("extra", {}).get(c, "") or "")
            widths[c] = min(max(widths.get(c, 0), len(val)), 40)

    def _fmt(val, w):
        s = str(val or "")
        return s[:w].ljust(w) if len(s) <= w else s[:w-1] + "…"

    lines = []
    # Header
    header = "  ".join(_fmt(c, widths.get(c, len(c))) for c in cols)
    lines.append(header)
    lines.append("─" * len(header))

    for i, r in enumerate(rows):
        row_vals = [
            _fmt(i + 1, widths["#"]),
            _fmt(r["title"], widths["title"]),
            _fmt(r["company"], widths["company"]),
            _fmt(r["location"], widths["location"]),
        ]
        for c in fields:
            val = str(r.get("extra", {}).get(c, "") or "")
            row_vals.append(_fmt(val, widths[c]))
        lines.append("  ".join(row_vals))

    lines.append("")
    lines.append(f"{len(rows)} jobs  |  columns: {', '.join(cols)}")
    print("\n".join(lines))
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="rolefit", description="RoleFit agent CLI")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("applicants", help="list profiles' RoleFit flags/tags").set_defaults(fn=cmd_applicants)

    t = sub.add_parser("tag", help="add/remove tags on a profile")
    t.add_argument("slug")
    t.add_argument("--add", nargs="*")
    t.add_argument("--remove", nargs="*")
    t.set_defaults(fn=cmd_tag)

    sr = sub.add_parser("set-role", help="agent: set inferred role for a profile")
    sr.add_argument("slug")
    sr.add_argument("role")
    sr.set_defaults(fn=cmd_set_role)

    s = sub.add_parser("apify-search", help="search Apify store (free)")
    s.add_argument("query")
    s.add_argument("--limit", type=int, default=8)
    s.set_defaults(fn=cmd_apify_search)

    pr = sub.add_parser("apify-pricing", help="actor pricing detail (free)")
    pr.add_argument("actor_id")
    pr.set_defaults(fn=cmd_apify_pricing)

    sc = sub.add_parser("apify-schema", help="actor input fields/filters (free)")
    sc.add_argument("actor_id")
    sc.set_defaults(fn=cmd_apify_schema)

    pc = sub.add_parser("pull-config", help="save the approved actor + input")
    pc.add_argument("--actor", required=True)
    pc.add_argument("--input", help="JSON actor input")
    pc.add_argument("--cost", type=float)
    pc.add_argument("--schedule", default="0 7 * * *")
    pc.add_argument("--approved", action="store_true")
    pc.set_defaults(fn=cmd_pull_config)

    sub.add_parser("show-config", help="show saved apify config").set_defaults(fn=cmd_show_config)

    rp = sub.add_parser("run-pull", help="run the pull (COSTS MONEY; needs --confirm)")
    rp.add_argument("--confirm", action="store_true")
    rp.add_argument("--max-items", type=int, default=50)
    rp.set_defaults(fn=cmd_run_pull)

    j = sub.add_parser("jobs", help="list pulled jobs")
    j.add_argument("--limit", type=int, default=20)
    j.set_defaults(fn=cmd_jobs)

    sub.add_parser("job-fields", help="list actual fields the pulled jobs contain").set_defaults(fn=cmd_job_fields)

    sjf = sub.add_parser("set-job-fields", help="choose which job fields to display")
    sjf.add_argument("fields", nargs="+")
    sjf.set_defaults(fn=cmd_set_job_fields)

    sr = sub.add_parser("set-requirements", help="set company hard requirements (plain English)")
    sr.add_argument("text")
    sr.set_defaults(fn=cmd_set_requirements)
    sub.add_parser("show-requirements", help="show company requirements + qualify counts").set_defaults(fn=cmd_show_requirements)
    ej = sub.add_parser("evaluate-jobs", help="flag jobs qualify/disqualify vs requirements")
    ej.add_argument("--all", action="store_true", help="re-evaluate all jobs, not just unflagged")
    ej.add_argument("--research", action="store_true", help="free web-research ambiguous jobs")
    ej.set_defaults(fn=cmd_evaluate_jobs)

    sb = sub.add_parser("set-background", help="set a person's experience/skills (for matching+CV)")
    sb.add_argument("slug"); sb.add_argument("text")
    sb.set_defaults(fn=cmd_set_background)
    sc = sub.add_parser("score", help="match-score job-seekers vs qualified jobs")
    sc.add_argument("--person"); sc.add_argument("--rescore", action="store_true")
    sc.add_argument("--all-jobs", action="store_true", help="score all jobs, not just qualified")
    sc.set_defaults(fn=cmd_score)
    mt = sub.add_parser("matches", help="list match results (analyses)")
    mt.add_argument("--person"); mt.add_argument("--min-score", type=int)
    mt.add_argument("--limit", type=int, default=100)
    mt.set_defaults(fn=cmd_matches)
    gn = sub.add_parser("generate", help="generate CV/cover/interview/learning for a match")
    gn.add_argument("--person", required=True)
    gn.add_argument("--job", help="job id (omit to generate for all strong matches)")
    gn.add_argument("--what", help="comma list: cv,cover,interview,learning")
    gn.add_argument("--min-score", type=int, default=80)
    gn.set_defaults(fn=cmd_generate)

    fb = sub.add_parser("feedback", help="thumbs up/down a match (self-improves scoring)")
    fb.add_argument("--person", required=True); fb.add_argument("--job", required=True)
    fb.add_argument("--score", type=int, required=True, help="1=good, -1=bad, 0=clear")
    fb.add_argument("--note")
    fb.set_defaults(fn=cmd_feedback)
    tk = sub.add_parser("track", help="add match(es) to the application tracker")
    tk.add_argument("--person", required=True); tk.add_argument("--job")
    tk.add_argument("--status", default="shortlisted"); tk.add_argument("--min-score", type=int, default=80)
    tk.set_defaults(fn=cmd_track)
    am = sub.add_parser("app-move", help="move an application to a new status")
    am.add_argument("--id", required=True); am.add_argument("--status", required=True)
    am.set_defaults(fn=cmd_app_move)
    ap = sub.add_parser("applications", help="show the application board")
    ap.add_argument("--person")
    ap.set_defaults(fn=cmd_applications)

    ps = sub.add_parser("pull-source", help="pull jobs from a FREE source (remoteok/greenhouse/lever)")
    ps.add_argument("source", choices=["remoteok", "greenhouse", "lever"])
    ps.add_argument("--search"); ps.add_argument("--company")
    ps.set_defaults(fn=cmd_pull_source)

    rd = sub.add_parser("run-daily", help="autonomous pipeline: pull→flag→score→generate→digest")
    rd.add_argument("--digest", action="store_true", help="print only the markdown digest")
    rd.add_argument("--no-pull", action="store_true")
    rd.add_argument("--no-research", action="store_true")
    rd.add_argument("--generate-min", type=int, default=80)
    rd.set_defaults(fn=cmd_run_daily)
    sd = sub.add_parser("schedule-daily", help="register a daily cron job for the pipeline")
    sd.add_argument("--schedule", default="0 7 * * *", help="cron expr (default 7am daily)")
    sd.add_argument("--deliver", default="local", help="telegram/email/slack/discord/local")
    sd.set_defaults(fn=cmd_schedule_daily)

    sub.add_parser("stats", help="quick system state (jobs/applicants/config)").set_defaults(fn=cmd_stats)
    sub.add_parser("clear-jobs", help="delete ALL jobs from the pool (destructive)").set_defaults(fn=cmd_clear_jobs)
    sub.add_parser("dedup", help="remove duplicate jobs (same title+company)").set_defaults(fn=cmd_dedup)

    ar = sub.add_parser("apify-runs", help="list recent successful runs across all actors (free)")
    ar.add_argument("--limit", type=int, default=50)
    ar.set_defaults(fn=cmd_apify_runs)

    ia = sub.add_parser("import-all", help="import datasets from all recent runs into jobs (free)")
    ia.add_argument("--limit", type=int, default=50, help="how many recent runs to scan")
    ia.add_argument("--max-per-dataset", type=int, default=1000)
    ia.set_defaults(fn=cmd_import_all)

    imp = sub.add_parser("import-dataset", help="ingest an existing Apify dataset (free)")
    imp.add_argument("--dataset", required=True)
    imp.add_argument("--limit", type=int, default=1000)
    imp.set_defaults(fn=cmd_import_dataset)

    args = p.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
