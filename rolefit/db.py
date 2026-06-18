"""RoleFit SQLite store (`rolefit.db`).

Separate from Hermes `state.db` (which Hermes migrates on upgrade) so upstream
pulls never collide with our schema. Pure stdlib — no Hermes imports, so this
module loads and tests without the full agent runtime.

Schema is versioned via `PRAGMA user_version`. Add a migration step to
`_MIGRATIONS` for every change; never edit an existing step.

Tenancy: every domain row carries `tenant_id` (default 'default' for the
single-team MVP). Full isolation/billing is deferred to Phase 5, but the column
is here now so we never have to backfill.
"""

from __future__ import annotations

import os
import sqlite3
import threading
from pathlib import Path

SCHEMA_VERSION = 9
DEFAULT_TENANT = "default"


def hermes_home() -> Path:
    """Resolve HERMES_HOME without importing Hermes.

    Mirrors Hermes' own resolution (env override → ~/.hermes) so RoleFit's DB
    lands beside the active profile's home. When RoleFit runs inside the agent
    we can later swap this for `hermes_constants.get_hermes_home()`.
    """
    env = os.environ.get("HERMES_HOME")
    if env:
        return Path(env).expanduser()
    return Path.home() / ".hermes"


def db_path() -> Path:
    override = os.environ.get("ROLEFIT_DB_PATH")
    if override:
        return Path(override).expanduser()
    return hermes_home() / "rolefit.db"


# --- schema ----------------------------------------------------------------

# Each migration is (version, list-of-SQL-statements). Applied in order for any
# version above the DB's current user_version. Append-only.
_MIGRATIONS: list[tuple[int, list[str]]] = [
    (
        1,
        [
            # People = index rows for the dashboard. The rich persona/CV lives in
            # the Hermes OS-profile at ~/.hermes/profiles/<profile_slug>/SOUL.md;
            # this row links to it via profile_slug for fast queries.
            """
            CREATE TABLE IF NOT EXISTS people (
                id            TEXT PRIMARY KEY,
                tenant_id     TEXT NOT NULL DEFAULT 'default',
                profile_slug  TEXT NOT NULL,
                name          TEXT NOT NULL,
                headline      TEXT,
                cv_path       TEXT,
                cv_text       TEXT,
                skills_json   TEXT,        -- JSON array of parsed skills
                persona       TEXT,        -- short blurb (also seeded into SOUL.md)
                created_at    REAL NOT NULL,
                updated_at    REAL NOT NULL
            )
            """,
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_people_slug ON people(tenant_id, profile_slug)",
            "CREATE INDEX IF NOT EXISTS idx_people_tenant ON people(tenant_id)",
            # Apify actor config approved via the main-agent setup flow.
            """
            CREATE TABLE IF NOT EXISTS apify_config (
                id             TEXT PRIMARY KEY,
                tenant_id      TEXT NOT NULL DEFAULT 'default',
                actor_id       TEXT NOT NULL,
                actor_name     TEXT,
                input_json     TEXT,        -- actor run input (filters)
                cost_estimate  REAL,        -- USD per run, as previewed
                approved       INTEGER NOT NULL DEFAULT 0,
                schedule       TEXT,        -- cron expr / interval for daily pull
                created_at     REAL NOT NULL,
                updated_at     REAL NOT NULL
            )
            """,
            "CREATE INDEX IF NOT EXISTS idx_apify_tenant ON apify_config(tenant_id)",
            # Jobs pulled from Apify (or other sources).
            """
            CREATE TABLE IF NOT EXISTS jobs (
                id           TEXT PRIMARY KEY,
                tenant_id    TEXT NOT NULL DEFAULT 'default',
                source       TEXT NOT NULL DEFAULT 'apify',
                apify_run_id TEXT,
                external_id  TEXT,          -- dedup key from source
                title        TEXT,
                company      TEXT,
                location     TEXT,
                url          TEXT,
                description  TEXT,
                raw_json     TEXT,
                pulled_at    REAL NOT NULL
            )
            """,
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_ext ON jobs(tenant_id, source, external_id)",
            "CREATE INDEX IF NOT EXISTS idx_jobs_tenant_pulled ON jobs(tenant_id, pulled_at)",
            # Analyses = one row per (job, person). Stage 1 fills score/gap;
            # Stage 2 fills the artifact paths (CV/cover/etc).
            """
            CREATE TABLE IF NOT EXISTS analyses (
                id              TEXT PRIMARY KEY,
                tenant_id       TEXT NOT NULL DEFAULT 'default',
                job_id          TEXT NOT NULL,
                person_id       TEXT NOT NULL,
                match_score     INTEGER,     -- 0-100 (Stage 1)
                rationale       TEXT,
                gap_json        TEXT,        -- skills gap (Stage 1)
                stage           INTEGER NOT NULL DEFAULT 1,   -- highest completed stage
                status          TEXT NOT NULL DEFAULT 'pending',
                cv_path         TEXT,        -- Stage 2 artifacts
                cover_path      TEXT,
                interview_path  TEXT,
                learning_path   TEXT,
                tokens          INTEGER,
                cost            REAL,
                created_at      REAL NOT NULL,
                updated_at      REAL NOT NULL
            )
            """,
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_analyses_pair ON analyses(job_id, person_id)",
            "CREATE INDEX IF NOT EXISTS idx_analyses_tenant_score ON analyses(tenant_id, match_score)",
            "CREATE INDEX IF NOT EXISTS idx_analyses_person ON analyses(person_id)",
            # Runs = audit log of pull/score/generate batches (cost tracking + approval-gate).
            """
            CREATE TABLE IF NOT EXISTS runs (
                id           TEXT PRIMARY KEY,
                tenant_id    TEXT NOT NULL DEFAULT 'default',
                kind         TEXT NOT NULL,   -- pull | score | generate
                status       TEXT NOT NULL DEFAULT 'running',
                cost         REAL DEFAULT 0,
                started_at   REAL NOT NULL,
                finished_at  REAL,
                log          TEXT
            )
            """,
            "CREATE INDEX IF NOT EXISTS idx_runs_tenant_kind ON runs(tenant_id, kind, started_at)",
        ],
    ),
    (
        2,
        [
            # People are now NATIVE Hermes profiles (created via the ProfileBuilder
            # — model + SOUL + skills). RoleFit no longer owns person identity/CV.
            # Drop the old `people` table; keep only RoleFit-specific flags keyed by
            # the native profile slug.
            "DROP TABLE IF EXISTS people",
            """
            CREATE TABLE IF NOT EXISTS applicants (
                profile_slug      TEXT NOT NULL,
                tenant_id         TEXT NOT NULL DEFAULT 'default',
                is_seeker         INTEGER NOT NULL DEFAULT 1,
                target_roles_json TEXT,        -- JSON array of desired role keywords
                locations_json    TEXT,        -- JSON array of target locations
                notes             TEXT,
                created_at        REAL NOT NULL,
                updated_at        REAL NOT NULL,
                PRIMARY KEY (tenant_id, profile_slug)
            )
            """,
            "CREATE INDEX IF NOT EXISTS idx_applicants_seeker ON applicants(tenant_id, is_seeker)",
            # analyses/jobs referenced person_id (people.id); now they reference the
            # native profile slug. No rows exist yet, so just rename the column intent
            # via a fresh column — keep person_id for back-compat but treat it as slug.
        ],
    ),
    (
        3,
        [
            # Free-form tags on each profile. The MAIN AGENT reads these to decide
            # each profile's job (job-seeker vs other task) — `role` is what the
            # agent assigns/infers (e.g. 'job-seeker', 'recruiter', 'data-task').
            "ALTER TABLE applicants ADD COLUMN tags_json TEXT",
            "ALTER TABLE applicants ADD COLUMN role TEXT",
        ],
    ),
    (
        4,
        [
            # Generic key/value store. Used (among other things) for the agent's
            # chosen job-display fields — nothing about job shape is hardcoded;
            # the agent discovers the actual Apify fields and records its choice.
            """
            CREATE TABLE IF NOT EXISTS meta (
                tenant_id TEXT NOT NULL DEFAULT 'default',
                key       TEXT NOT NULL,
                value     TEXT,
                PRIMARY KEY (tenant_id, key)
            )
            """,
        ],
    ),
    (
        5,
        [
            # Persistent Setup-Agent chat transcript so users can revisit, resume,
            # and delete conversations. session_id ties to the Hermes session
            # (used for --resume continuity).
            """
            CREATE TABLE IF NOT EXISTS chat_messages (
                id         TEXT PRIMARY KEY,
                tenant_id  TEXT NOT NULL DEFAULT 'default',
                session_id TEXT NOT NULL,
                role       TEXT NOT NULL,        -- 'user' | 'agent'
                text       TEXT,
                created_at REAL NOT NULL
            )
            """,
            "CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(tenant_id, session_id, created_at)",
        ],
    ),
    (
        6,
        [
            # Company-requirements filter: each job flagged qualify/disqualify
            # against the company's rules by the requirements evaluator.
            # qualified: NULL = not yet evaluated, 1 = qualifies, 0 = disqualified.
            "ALTER TABLE jobs ADD COLUMN qualified INTEGER",
            "ALTER TABLE jobs ADD COLUMN qualify_reason TEXT",
            "CREATE INDEX IF NOT EXISTS idx_jobs_qualified ON jobs(tenant_id, qualified)",
        ],
    ),
    (
        7,
        [
            # The Requirement Agent's decision trace per job — JSON list of steps
            # (initial classification → optional web research → final verdict) so the
            # UI can show exactly HOW a job was qualified/disqualified.
            "ALTER TABLE jobs ADD COLUMN qualify_trace TEXT",
        ],
    ),
    (
        8,
        [
            # Each applicant's described background (experience, skills, education) —
            # the INPUT used to score matches and generate tailored CVs/cover letters.
            "ALTER TABLE applicants ADD COLUMN background TEXT",
        ],
    ),
    (
        9,
        [
            # Multi-criteria scoring (sub-scores + evidence per criterion).
            "ALTER TABLE analyses ADD COLUMN criteria_json TEXT",
            # Self-improvement: user feedback on a match (1=good, -1=bad, NULL=none).
            "ALTER TABLE analyses ADD COLUMN feedback INTEGER",
            "ALTER TABLE analyses ADD COLUMN feedback_note TEXT",
            # Application tracker — one row per job a person is pursuing.
            """
            CREATE TABLE IF NOT EXISTS applications (
                id          TEXT PRIMARY KEY,
                tenant_id   TEXT NOT NULL DEFAULT 'default',
                person_id   TEXT NOT NULL,
                job_id      TEXT NOT NULL,
                status      TEXT NOT NULL DEFAULT 'shortlisted',
                notes       TEXT,
                created_at  REAL NOT NULL,
                updated_at  REAL NOT NULL
            )
            """,
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_app_pair ON applications(tenant_id, person_id, job_id)",
            "CREATE INDEX IF NOT EXISTS idx_app_status ON applications(tenant_id, person_id, status)",
        ],
    ),
]


def get_meta(key: str, *, tenant_id: str = DEFAULT_TENANT, default=None):
    conn = connect()
    r = conn.execute(
        "SELECT value FROM meta WHERE tenant_id=? AND key=?", (tenant_id, key)
    ).fetchone()
    return r[0] if r else default


def set_meta(key: str, value: str, *, tenant_id: str = DEFAULT_TENANT) -> None:
    conn = connect()
    conn.execute(
        "INSERT INTO meta (tenant_id, key, value) VALUES (?,?,?) "
        "ON CONFLICT(tenant_id, key) DO UPDATE SET value=excluded.value",
        (tenant_id, key, value),
    )
    conn.commit()

_local = threading.local()


def connect() -> sqlite3.Connection:
    """Per-thread connection with WAL + foreign keys, schema ensured once."""
    conn = getattr(_local, "conn", None)
    if conn is not None:
        return conn
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    _migrate(conn)
    _local.conn = conn
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    cur = conn.execute("PRAGMA user_version")
    current = cur.fetchone()[0]
    for version, statements in _MIGRATIONS:
        if version <= current:
            continue
        for sql in statements:
            conn.execute(sql)
        conn.execute(f"PRAGMA user_version = {version}")
        conn.commit()
        current = version


def init_db() -> Path:
    """Create/upgrade the DB and return its path. Safe to call repeatedly."""
    connect()
    return db_path()


if __name__ == "__main__":
    p = init_db()
    c = connect()
    tables = [r[0] for r in c.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )]
    ver = c.execute("PRAGMA user_version").fetchone()[0]
    print(f"rolefit.db @ {p}")
    print(f"schema_version={ver} (expected {SCHEMA_VERSION})")
    print("tables:", ", ".join(tables))
