"""Reply formatter.

DeepSeek (and similar) often dump their chain-of-thought into the answer content,
so the user sees a wall of "Wait, let me re-read…" reasoning. This module does a
cheap, tool-less second pass that rewrites the raw answer into a clean, concise
Markdown message (headings, bold, real tables) with all internal reasoning
removed — i.e. code that generates a proper response.

Best-effort: if no provider key is available or the call fails, returns the raw
text unchanged so we never lose the answer.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

import httpx

# provider → (base_url, env key, fast model)
_PROVIDERS = [
    ("https://api.deepseek.com", "DEEPSEEK_API_KEY", "deepseek-chat"),
    ("https://openrouter.ai/api/v1", "OPENROUTER_API_KEY", "deepseek/deepseek-chat"),
    ("https://api.openai.com/v1", "OPENAI_API_KEY", "gpt-4o-mini"),
]

_SYSTEM = (
    "You are a formatter. Rewrite the assistant message below into a clean, "
    "concise, well-structured Markdown reply for the end user. Rules:\n"
    "- Remove ALL internal reasoning, planning, and meta-narration "
    "(\"Let me…\", \"The user wants…\", \"Wait,…\", \"I should…\").\n"
    "- Keep only the user-facing content: recommendations, costs, results, next steps.\n"
    "- Use short headings, bold labels, bullet points, and Markdown tables where "
    "they make it clearer (e.g. a field/value or option/cost comparison).\n"
    "- Be tight. No preamble like 'Here is the formatted version'. Output ONLY the "
    "final Markdown the user should see.\n"
    "- Preserve any code blocks / ASCII diagrams as fenced code blocks."
)


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


# reasoning-dump signatures — only pay the format round-trip when these appear
_RAMBLE = (
    "let me", "wait,", "wait.", "the user want", "the user ask", "the user said",
    "actually,", "i should ", "i need to ", "first, let me", "hmm", "okay,",
    "but the skill", "let me re-read", "let me think", "i'll start", "let me check",
)


def needs_format(text: str) -> bool:
    """True only when the text looks like it carries internal reasoning. Clean,
    already-structured answers skip the (latency-adding) format round-trip."""
    low = text.lower()
    return any(m in low for m in _RAMBLE)


def format_reply(raw: str, *, timeout: float = 20.0) -> str:
    raw = (raw or "").strip()
    if len(raw) < 40 or not needs_format(raw):
        return raw  # short or already clean — no round-trip, instant
    for base_url, env_key, model in _PROVIDERS:
        key = _env(env_key)
        if not key:
            continue
        try:
            r = httpx.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {key}"},
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": _SYSTEM},
                        {"role": "user", "content": raw},
                    ],
                    "temperature": 0.2,
                    "stream": False,
                },
                timeout=timeout,
            )
            r.raise_for_status()
            out = r.json()["choices"][0]["message"]["content"].strip()
            return out or raw
        except Exception:
            continue  # try next provider, else fall back to raw
    return raw
