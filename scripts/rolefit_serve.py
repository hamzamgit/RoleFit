#!/usr/bin/env python
"""Lightweight RoleFit dashboard launcher.

Serves the Hermes web_server FastAPI app (SPA dist + REST API, incl. the RoleFit
routes) directly via uvicorn — bypassing the `hermes dashboard` launcher's TUI
(browser-terminal) install step, which needs a heavy npm install. The in-browser
chat/terminal tab won't function under this launcher, but every dashboard page
(Applicants, Profiles, Jobs, etc.) and all REST APIs do.

Usage:
    HERMES_DASHBOARD_SESSION_TOKEN=<tok> .venv/bin/python scripts/rolefit_serve.py [port]
"""

import os
import sys

os.environ.setdefault("HERMES_DASHBOARD_SESSION_TOKEN", "rolefit")

import uvicorn  # noqa: E402

from hermes_cli.web_server import app  # noqa: E402

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9191
    token = os.environ["HERMES_DASHBOARD_SESSION_TOKEN"]
    print(f"RoleFit dashboard → http://127.0.0.1:{port}  (token={token})", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
