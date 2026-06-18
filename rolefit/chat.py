"""Persistent Setup-Agent chat transcript.

Stores user + agent messages keyed by the Hermes session_id (the same id used for
--resume), so a conversation survives refreshes and can be revisited or deleted.
"""

from __future__ import annotations

import time
import uuid
from typing import Any

from . import db as _db


def save_message(session_id: str, role: str, text: str, *,
                 tenant_id: str = _db.DEFAULT_TENANT, ts: float | None = None) -> None:
    conn = _db.connect()
    conn.execute(
        "INSERT INTO chat_messages (id, tenant_id, session_id, role, text, created_at) "
        "VALUES (?,?,?,?,?,?)",
        (str(uuid.uuid4()), tenant_id, session_id, role, text, ts or time.time()),
    )
    conn.commit()


def list_sessions(*, tenant_id: str = _db.DEFAULT_TENANT) -> list[dict[str, Any]]:
    """One row per conversation: id, title (first user message), counts, last activity."""
    conn = _db.connect()
    rows = conn.execute(
        """
        SELECT session_id,
               COUNT(*)        AS message_count,
               MAX(created_at) AS updated_at,
               MIN(created_at) AS started_at
        FROM chat_messages WHERE tenant_id=?
        GROUP BY session_id ORDER BY updated_at DESC
        """,
        (tenant_id,),
    ).fetchall()
    out = []
    for r in rows:
        first = conn.execute(
            "SELECT text FROM chat_messages WHERE tenant_id=? AND session_id=? "
            "AND role='user' ORDER BY created_at LIMIT 1",
            (tenant_id, r["session_id"]),
        ).fetchone()
        title = (first["text"] if first else "") or "(no prompt)"
        out.append({
            "session_id": r["session_id"],
            "title": title[:80],
            "message_count": r["message_count"],
            "updated_at": r["updated_at"],
            "started_at": r["started_at"],
        })
    return out


def get_messages(session_id: str, *, tenant_id: str = _db.DEFAULT_TENANT) -> list[dict[str, Any]]:
    conn = _db.connect()
    rows = conn.execute(
        "SELECT role, text, created_at FROM chat_messages "
        "WHERE tenant_id=? AND session_id=? ORDER BY created_at",
        (tenant_id, session_id),
    ).fetchall()
    return [dict(r) for r in rows]


def delete_session(session_id: str, *, tenant_id: str = _db.DEFAULT_TENANT) -> int:
    conn = _db.connect()
    cur = conn.execute(
        "DELETE FROM chat_messages WHERE tenant_id=? AND session_id=?",
        (tenant_id, session_id),
    )
    conn.commit()
    return cur.rowcount
