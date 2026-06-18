#!/usr/bin/env python3
"""Remove all jobs from the RoleFit DB."""
import sqlite3

DB = "/home/enigmatix/.hermes/rolefit.db"
conn = sqlite3.connect(DB)
before = conn.execute("SELECT COUNT(*) FROM jobs WHERE tenant_id=?", ("default",)).fetchone()[0]
conn.execute("DELETE FROM jobs WHERE tenant_id=?", ("default",))
conn.commit()
after = conn.execute("SELECT COUNT(*) FROM jobs WHERE tenant_id=?", ("default",)).fetchone()[0]
print(f"Deleted {before} jobs. Remaining: {after}")
conn.close()
