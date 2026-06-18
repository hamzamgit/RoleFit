"""Applicants — RoleFit-specific flags layered over NATIVE Hermes profiles.

A "person" is a native Hermes profile (created via the ProfileBuilder: model +
SOUL/persona + skills). RoleFit does NOT own person identity, CV, or model — it
only records which profiles are active job-seekers and their target roles, keyed
by the profile slug. The frontend merges these flags with `GET /api/profiles`.
"""

from __future__ import annotations

import json
import sqlite3
import time
from typing import Any, Optional

from . import db as _db


def _row(r: sqlite3.Row) -> dict[str, Any]:
    d = dict(r)
    d["target_roles"] = json.loads(d.pop("target_roles_json", None) or "[]")
    d["locations"] = json.loads(d.pop("locations_json", None) or "[]")
    d["tags"] = json.loads(d.pop("tags_json", None) or "[]")
    d["is_seeker"] = bool(d["is_seeker"])
    return d


def list_applicants(*, tenant_id: str = _db.DEFAULT_TENANT) -> list[dict[str, Any]]:
    conn = _db.connect()
    rows = conn.execute(
        "SELECT * FROM applicants WHERE tenant_id=? ORDER BY updated_at DESC",
        (tenant_id,),
    ).fetchall()
    return [_row(r) for r in rows]


def get_applicant(slug: str, *, tenant_id: str = _db.DEFAULT_TENANT) -> Optional[dict[str, Any]]:
    conn = _db.connect()
    r = conn.execute(
        "SELECT * FROM applicants WHERE tenant_id=? AND profile_slug=?",
        (tenant_id, slug),
    ).fetchone()
    return _row(r) if r else None


def upsert_applicant(
    slug: str,
    *,
    tenant_id: str = _db.DEFAULT_TENANT,
    is_seeker: Optional[bool] = None,
    target_roles: Optional[list[str]] = None,
    locations: Optional[list[str]] = None,
    notes: Optional[str] = None,
    tags: Optional[list[str]] = None,
    role: Optional[str] = None,
    background: Optional[str] = None,
) -> dict[str, Any]:
    """Create or update RoleFit flags for a profile slug. Partial updates allowed.

    `tags` are human-assigned free-form labels; `role` is what the main agent
    infers from them; `background` is the person's described experience/skills used
    for match scoring + CV generation.
    """
    conn = _db.connect()
    now = time.time()
    existing = get_applicant(slug, tenant_id=tenant_id)
    if existing is None:
        conn.execute(
            """INSERT INTO applicants
               (profile_slug, tenant_id, is_seeker, target_roles_json,
                locations_json, notes, tags_json, role, background, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (
                slug, tenant_id,
                1 if (is_seeker if is_seeker is not None else True) else 0,
                json.dumps(target_roles or []),
                json.dumps(locations or []),
                notes,
                json.dumps(tags or []),
                role,
                background,
                now, now,
            ),
        )
    else:
        sets, vals = [], []
        if is_seeker is not None:
            sets.append("is_seeker=?"); vals.append(1 if is_seeker else 0)
        if target_roles is not None:
            sets.append("target_roles_json=?"); vals.append(json.dumps(target_roles))
        if locations is not None:
            sets.append("locations_json=?"); vals.append(json.dumps(locations))
        if notes is not None:
            sets.append("notes=?"); vals.append(notes)
        if tags is not None:
            sets.append("tags_json=?"); vals.append(json.dumps(tags))
        if role is not None:
            sets.append("role=?"); vals.append(role)
        if background is not None:
            sets.append("background=?"); vals.append(background)
        sets.append("updated_at=?"); vals.append(now)
        vals += [tenant_id, slug]
        conn.execute(
            f"UPDATE applicants SET {', '.join(sets)} WHERE tenant_id=? AND profile_slug=?",
            vals,
        )
    conn.commit()
    return get_applicant(slug, tenant_id=tenant_id)  # type: ignore[return-value]


def delete_applicant(slug: str, *, tenant_id: str = _db.DEFAULT_TENANT) -> bool:
    conn = _db.connect()
    cur = conn.execute(
        "DELETE FROM applicants WHERE tenant_id=? AND profile_slug=?",
        (tenant_id, slug),
    )
    conn.commit()
    return cur.rowcount > 0
