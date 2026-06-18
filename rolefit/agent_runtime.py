"""In-process, warm-reused Hermes ``AIAgent`` runner for the RoleFit Setup chat.

The previous implementation spawned a fresh ``hermes chat`` subprocess for every
message, paying the full python-import + AIAgent-init + model-handshake cost
(~15-30s) on EVERY turn. This module builds the ``AIAgent`` ONCE per chat
session, caches it in-process, and reuses it across turns so 2nd+ turns are
fast (no re-init; the agent object retains conversation state in memory).

Construction mirrors ``hermes_cli.oneshot._run_agent`` (config/model/provider
resolution, toolsets, session DB, fallback chain, non-interactive env + clarify
callback). The ``rolefit-job-setup`` skill is preloaded via the native
``agent.skill_commands.build_preloaded_skills_prompt`` mechanism and injected
through ``ephemeral_system_prompt`` (which ``init_agent`` appends to the system
prompt — same effect as ``hermes chat -s rolefit-job-setup``).

``run_turn(session_id, message)`` runs ONE user turn and yields structured event
dicts as they happen. ``AIAgent.chat()`` is blocking and fires its callbacks
synchronously from inside the call, so we run it on a background thread, have the
callbacks push events into a ``queue.Queue``, and drain that queue here — making
the native structured stream consumable from FastAPI's StreamingResponse.

Event shapes yielded:
    {"type": "thinking",  "text": <reasoning delta>}
    {"type": "cmd",       "text": <tool/command summary>}
    {"type": "tool_done"}
    {"type": "answer",    "text": <assistant content delta>}

One concurrent turn per session is enforced with a per-session lock; the module
cache itself is guarded by a global lock.
"""

from __future__ import annotations

import os
import queue
import threading
import uuid
from dataclasses import dataclass, field
from typing import Any, Iterator, Optional

_AGENT_SKILL = "rolefit-job-setup"
_MAX_ITERATIONS = 18

# Non-interactive run flags — identical to oneshot. Set at import time so the
# very first agent build (which reads these) already sees them. Idempotent.
os.environ.setdefault("HERMES_YOLO_MODE", "1")
os.environ.setdefault("HERMES_ACCEPT_HOOKS", "1")


def _clarify_callback(question: str, choices=None) -> str:
    """Auto-answer clarify prompts so the agent never stalls (no human here)."""
    if choices:
        return (
            f"[non-interactive session: no user available. Pick the best option "
            f"from {choices} using your own judgment and continue.]"
        )
    return (
        "[non-interactive session: no user available. Make the most reasonable "
        "assumption you can and continue.]"
    )


@dataclass
class _Session:
    agent: Any
    lock: threading.Lock = field(default_factory=threading.Lock)


# session_id -> _Session. Guarded by _CACHE_LOCK.
_CACHE: dict[str, _Session] = {}
_CACHE_LOCK = threading.Lock()


def _build_skill_prompt(session_id: str) -> Optional[str]:
    """Native skill preload: returns the system-prompt text for the skill, or
    None if it could not be loaded (agent still runs, just without the skill)."""
    try:
        from agent.skill_commands import build_preloaded_skills_prompt

        prompt, _loaded, _missing = build_preloaded_skills_prompt(
            [_AGENT_SKILL], task_id=session_id
        )
        return prompt or None
    except Exception:
        return None


def _construct_agent(session_id: str):
    """Build an AIAgent exactly like a CLI chat turn would (see oneshot._run_agent),
    with structured callbacks left UNWIRED here — run_turn wires them per turn."""
    from hermes_cli.config import load_config
    from hermes_cli.models import detect_provider_for_model
    from hermes_cli.runtime_provider import resolve_runtime_provider
    from hermes_cli.tools_config import _get_platform_tools
    from hermes_cli.fallback_config import get_fallback_chain
    from run_agent import AIAgent

    cfg = load_config()

    # Resolve effective model: env var → config.
    model_cfg = cfg.get("model") or {}
    if isinstance(model_cfg, str):
        cfg_model = model_cfg
    else:
        cfg_model = model_cfg.get("default") or model_cfg.get("model") or ""
    env_model = os.getenv("HERMES_INFERENCE_MODEL", "").strip()
    effective_model = env_model or cfg_model

    # Resolve effective provider (config → env → auto-detect from model).
    effective_provider: Optional[str] = None
    if isinstance(model_cfg, dict):
        effective_provider = (model_cfg.get("provider") or "").strip() or None
    effective_provider = (
        effective_provider
        or os.getenv("HERMES_INFERENCE_PROVIDER", "").strip()
        or None
    )
    if effective_provider is None and effective_model:
        try:
            detected = detect_provider_for_model(effective_model, "auto")
            if detected:
                effective_provider, effective_model = detected
        except Exception:
            pass

    runtime = resolve_runtime_provider(
        requested=effective_provider,
        target_model=effective_model or None,
    )

    # Toolsets: whatever the user has enabled for the "cli" platform (terminal,
    # etc.) — same as a normal chat turn. sorted() for stable ordering.
    try:
        toolsets_list = sorted(_get_platform_tools(cfg, "cli"))
    except Exception:
        toolsets_list = None

    # Persistent session store so transcripts/recall survive across server runs.
    try:
        from hermes_state import SessionDB

        session_db = SessionDB()
    except Exception:
        session_db = None

    try:
        fb = get_fallback_chain(cfg)
    except Exception:
        fb = None

    skill_prompt = _build_skill_prompt(session_id)

    agent = AIAgent(
        api_key=runtime.get("api_key"),
        base_url=runtime.get("base_url"),
        provider=runtime.get("provider"),
        api_mode=runtime.get("api_mode"),
        model=effective_model,
        enabled_toolsets=toolsets_list,
        quiet_mode=True,
        platform="cli",
        session_id=session_id,
        session_db=session_db,
        credential_pool=runtime.get("credential_pool"),
        fallback_model=fb or None,
        max_iterations=_MAX_ITERATIONS,
        ephemeral_system_prompt=skill_prompt,
        clarify_callback=_clarify_callback,
    )
    return agent


def get_agent(session_id: str):
    """Return the warm cached agent for ``session_id``, constructing it once on
    first use. Thread-safe; subsequent calls reuse the same (fast) agent."""
    with _CACHE_LOCK:
        sess = _CACHE.get(session_id)
        if sess is not None:
            return sess.agent
    # Build outside the cache lock (construction is slow ~ model handshake) so
    # other sessions aren't blocked. Double-check after building to avoid a race
    # that would discard a concurrently-built agent.
    agent = _construct_agent(session_id)
    with _CACHE_LOCK:
        existing = _CACHE.get(session_id)
        if existing is not None:
            return existing.agent
        _CACHE[session_id] = _Session(agent=agent)
        return agent


def _get_session(session_id: str) -> _Session:
    with _CACHE_LOCK:
        sess = _CACHE.get(session_id)
    if sess is None:
        get_agent(session_id)  # constructs + caches
        with _CACHE_LOCK:
            sess = _CACHE[session_id]
    return sess


# Sentinel pushed onto the queue when the background chat() call returns.
_DONE = object()


def run_turn(session_id: str, message: str) -> Iterator[dict[str, Any]]:
    """Run ONE user turn on the cached (warm) agent for ``session_id`` and yield
    structured events as they happen. Serialized per session.

    Yields dicts of {"type": "thinking"|"cmd"|"tool_done"|"answer", ...}.
    The final assembled answer is exposed via the generator's ``return`` value
    (StopIteration.value) AND can be reconstructed by the caller from the
    "answer" deltas; callers that need it cleanly should accumulate "answer"
    text, which this function also tracks and returns.
    """
    sess = _get_session(session_id)

    # Serialize turns per session — one chat() at a time per agent object.
    with sess.lock:
        agent = sess.agent
        evq: "queue.Queue[Any]" = queue.Queue()

        # --- callbacks: push structured events onto the queue ----------------
        def on_reasoning(text):  # reasoning_callback(text)
            if text:
                evq.put({"type": "thinking", "text": str(text)})

        def on_thinking(text):  # thinking_callback(text) — spinner/clear pings
            # Fired with "" to clear and with spinner faces ("😊 musing...").
            # Those carry no real content, so drop them; real reasoning comes
            # through reasoning_callback during streaming.
            return

        def on_tool_start(tool_id, name, args):  # tool_start_callback
            evq.put({"type": "cmd", "text": _summarize_tool(name, args)})

        def on_tool_complete(tool_id, name, args, result):  # tool_complete_callback
            evq.put({"type": "tool_done"})

        def on_tool_progress(*p, **k):  # tool_progress_callback (variadic)
            # event names: "tool.started" / "tool.completed" / "reasoning.available"
            try:
                event = p[0] if p else ""
            except Exception:
                event = ""
            if event == "reasoning.available":
                # p = ("reasoning.available", "_thinking", text, None)
                txt = p[2] if len(p) > 2 else ""
                if txt:
                    evq.put({"type": "thinking", "text": str(txt)})

        def on_stream_delta(delta):  # stream_delta_callback(delta_or_None)
            # ``None`` is a flush/boundary sentinel — ignore. Otherwise it's an
            # assistant-content text delta (the clean answer, already separated
            # from reasoning by the agent's streaming layer).
            if delta:
                evq.put({"type": "answer", "text": str(delta)})

        # Wire callbacks onto the (reused) agent for THIS turn.
        agent.reasoning_callback = on_reasoning
        agent.thinking_callback = on_thinking
        agent.tool_start_callback = on_tool_start
        agent.tool_complete_callback = on_tool_complete
        agent.tool_progress_callback = on_tool_progress
        agent.stream_delta_callback = on_stream_delta
        # Make sure nothing tries to write status to a real stdout/stderr.
        try:
            agent.suppress_status_output = True
        except Exception:
            pass

        result_box: dict[str, Any] = {"final": "", "error": None}

        def _worker():
            try:
                result_box["final"] = agent.chat(message) or ""
            except BaseException as exc:  # noqa: BLE001
                result_box["error"] = exc
            finally:
                evq.put(_DONE)

        worker = threading.Thread(target=_worker, daemon=True)
        worker.start()

        answer_parts: list[str] = []
        while True:
            ev = evq.get()
            if ev is _DONE:
                break
            if ev.get("type") == "answer":
                answer_parts.append(ev["text"])
            yield ev

        worker.join()

        # Prefer the streamed answer; fall back to chat()'s return value if the
        # provider didn't stream content deltas (non-streaming path).
        streamed = "".join(answer_parts).strip()
        final = streamed or (result_box["final"] or "").strip()
        if result_box["error"] is not None and not final:
            # Surface a terse error as the answer so the turn isn't silent.
            final = f"[agent error: {result_box['error']}]"
        return final


def _summarize_tool(name: str, args: Any) -> str:
    """Build a short human-readable summary of a tool call for the live feed."""
    name = str(name or "tool")
    try:
        if isinstance(args, dict):
            # terminal / shell-style tools: surface the command itself.
            for k in ("command", "cmd", "script", "code", "query", "url", "path"):
                v = args.get(k)
                if isinstance(v, str) and v.strip():
                    return f"{name}: {v.strip()[:200]}"
            # otherwise a compact key list
            keys = ", ".join(str(k) for k in list(args.keys())[:4])
            return f"{name}({keys})" if keys else name
    except Exception:
        pass
    return name


def drop_session(session_id: str) -> None:
    """Evict a cached agent (e.g. on session delete) to free memory."""
    with _CACHE_LOCK:
        _CACHE.pop(session_id, None)
