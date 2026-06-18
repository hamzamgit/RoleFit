"""Tiny provider-agnostic LLM helper.

Uses whatever chat-completions key is in `~/.hermes/.env` (DeepSeek → OpenRouter
→ OpenAI), so RoleFit's own LLM steps (reply formatting, the requirements
evaluator, …) don't depend on the agent runtime. Best-effort: raises only if no
provider is available.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Optional

import httpx

# (base_url, env key, model)
_PROVIDERS = [
    ("https://api.deepseek.com", "DEEPSEEK_API_KEY", "deepseek-chat"),
    ("https://openrouter.ai/api/v1", "OPENROUTER_API_KEY", "deepseek/deepseek-chat"),
    ("https://api.openai.com/v1", "OPENAI_API_KEY", "gpt-4o-mini"),
]


class NoProvider(RuntimeError):
    pass


def _env(key: str) -> Optional[str]:
    v = os.environ.get(key)
    if v:
        return v.strip()
    env = Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))) / ".env"
    if env.is_file():
        for line in env.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.startswith(f"{key}="):
                return line.split("=", 1)[1].strip()
    return None


def complete(system: str, user: str, *, temperature: float = 0.1,
             timeout: float = 60.0, json_mode: bool = False) -> str:
    """One chat completion. Returns the assistant text. Raises NoProvider if none."""
    last_err: Optional[Exception] = None
    for base_url, env_key, model in _PROVIDERS:
        key = _env(env_key)
        if not key:
            continue
        body: dict[str, Any] = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": temperature,
            "stream": False,
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        try:
            r = httpx.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {key}"},
                json=body, timeout=timeout,
            )
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"]
        except Exception as e:  # try next provider
            last_err = e
            continue
    raise NoProvider(f"no LLM provider available ({last_err})")


def complete_json(system: str, user: str, **kw: Any) -> Any:
    """complete() but parse a JSON object/array out of the reply (tolerant)."""
    txt = complete(system, user, json_mode=True, **kw)
    txt = txt.strip()
    # strip code fences if present
    if txt.startswith("```"):
        txt = txt.split("```", 2)[1] if "```" in txt[3:] else txt.strip("`")
        if txt.startswith("json"):
            txt = txt[4:]
    try:
        return json.loads(txt)
    except Exception:
        # find first {...} or [...] span
        for a, b in (("[", "]"), ("{", "}")):
            i, j = txt.find(a), txt.rfind(b)
            if i != -1 and j > i:
                try:
                    return json.loads(txt[i : j + 1])
                except Exception:
                    pass
        raise
