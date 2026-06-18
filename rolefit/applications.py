"""Application tracker — a per-person pipeline (kanban) of jobs they're pursuing.

Columns: shortlisted → applied → interview → offer → rejected. A match becomes an
application when the user (or Maestro) tracks it; status is moved as it progresses.
Backed by the `applications` table; the Applications page renders it as a board.
"""

from __future__ import annotations

import time
import uuid
from typing import Any, Optional

from . import db as _db

STATUSES = ["shortlisted", "applied", "interview", "offer", "rejected"]


def add(person: str, job_id: str, *, status: str = "shortlisted",
        tenant_id: str = _db.DEFAULT_TENANT) -> dict[str, Any]:
    conn = _db.connect()
    now = time.time()
    conn.execute(
        "INSERT INTO applications (id, tenant_id, person_id, job_id, status, created_at, updated_at) "
        "VALUES (?,?,?,?,?,?,?) "
        "ON CONFLICT(tenant_id, person_id, job_id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at",
        (str(uuid.uuid4()), tenant_id, person, job_id, status, now, now),
    )
    conn.commit()
    return {"person": person, "job_id": job_id, "status": status}


def move(app_id: str, status: str, *, tenant_id: str = _db.DEFAULT_TENANT) -> bool:
    if status not in STATUSES:
        return False
    conn = _db.connect()
    cur = conn.execute(
        "UPDATE applications SET status=?, updated_at=? WHERE id=? AND tenant_id=?",
        (status, time.time(), app_id, tenant_id),
    )
    conn.commit()
    return cur.rowcount > 0


def remove(app_id: str, *, tenant_id: str = _db.DEFAULT_TENANT) -> bool:
    conn = _db.connect()
    cur = conn.execute("DELETE FROM applications WHERE id=? AND tenant_id=?", (app_id, tenant_id))
    conn.commit()
    return cur.rowcount > 0


def set_notes(app_id: str, notes: str, *, tenant_id: str = _db.DEFAULT_TENANT) -> bool:
    conn = _db.connect()
    cur = conn.execute(
        "UPDATE applications SET notes=?, updated_at=? WHERE id=? AND tenant_id=?",
        (notes, time.time(), app_id, tenant_id),
    )
    conn.commit()
    return cur.rowcount > 0


def board(person: Optional[str] = None, *, tenant_id: str = _db.DEFAULT_TENANT) -> dict[str, list[dict[str, Any]]]:
    """Return applications grouped by status column, joined with job + match score."""
    conn = _db.connect()
    sql = (
        "SELECT ap.id, ap.person_id, ap.job_id, ap.status, ap.notes, ap.updated_at, "
        "j.title, j.company, j.location, j.url, a.match_score "
        "FROM applications ap JOIN jobs j ON j.id=ap.job_id "
        "LEFT JOIN analyses a ON a.job_id=ap.job_id AND a.person_id=ap.person_id "
        "WHERE ap.tenant_id=?"
    )
    params: list[Any] = [tenant_id]
    if person:
        sql += " AND ap.person_id=?"; params.append(person)
    sql += " ORDER BY a.match_score DESC"
    cols: dict[str, list[dict[str, Any]]] = {s: [] for s in STATUSES}
    for r in conn.execute(sql, params).fetchall():
        d = dict(r)
        cols.setdefault(d["status"], []).append(d)
    return cols


def add_strong_matches(person: str, *, min_score: int = 80,
                       tenant_id: str = _db.DEFAULT_TENANT) -> int:
    """Auto-shortlist a person's strong matches into the tracker."""
    from . import scoring as _scoring
    matches = _scoring.list_matches(tenant_id=tenant_id, person=person, min_score=min_score)
    for m in matches:
        add(person, m["job_id"], tenant_id=tenant_id)
    return len(matches)
