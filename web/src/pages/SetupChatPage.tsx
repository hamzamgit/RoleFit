import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowUp, Robot, Sparkle, Terminal, Brain,
  Plus, Trash, ChatCircle, CaretRight,
} from "@phosphor-icons/react";
import { Button } from "@nous-research/ui/ui/components/button";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { Markdown } from "@/components/Markdown";
import { usePageHeader } from "@/contexts/usePageHeader";
import { useChat, type Activity } from "@/contexts/chat-context";

const SUGGESTIONS = [
  "Classify our profiles from their tags, then recommend an Apify actor for remote software-engineering jobs and show the cost. Don't spend yet.",
  "What would pulling 50 jobs/day cost?",
  "Pull remote frontend-engineer jobs in the USA, 10 jobs, last 24h, using Indeed.",
];

function ActivityRow({ a }: { a: Activity }) {
  const icon =
    a.kind === "cmd" ? (
      <Terminal className="mt-0.5 size-3 shrink-0 text-text-tertiary" />
    ) : a.kind === "thinking" ? (
      <Brain className="mt-0.5 size-3 shrink-0 text-text-tertiary" />
    ) : null;
  return (
    <div className="flex items-start gap-1.5 text-xs text-text-tertiary">
      {icon}
      <span className={a.kind === "cmd" ? "font-mono" : ""}>{a.text}</span>
    </div>
  );
}

/** Collapsible "Thinking" block — expanded while live, collapsed once done. */
function ThinkingBlock({ activity, live }: { activity: Activity[]; live: boolean }) {
  const [open, setOpen] = useState(live);
  const wasLive = useRef(live);
  // auto-collapse when the turn finishes
  useEffect(() => {
    if (wasLive.current && !live) setOpen(false);
    wasLive.current = live;
  }, [live]);

  return (
    <div className="mb-2">
      <button
        className="flex items-center gap-1 text-xs text-text-tertiary hover:text-text-secondary"
        onClick={() => setOpen((o) => !o)}
      >
        <CaretRight className={`size-3 transition-transform ${open ? "rotate-90" : ""}`} />
        Thinking{live ? "…" : ` · ${activity.length} steps`}
      </button>
      {open && (
        <div className="mt-1 flex max-h-48 flex-col gap-1 overflow-y-auto border-l-2 border-border pl-2">
          {(live ? activity.slice(-10) : activity).map((a, j) => (
            <ActivityRow key={j} a={a} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function SetupChatPage() {
  const { setEnd } = usePageHeader();
  const { messages, sessionId, sessions, busy, send, loadSession, newChat, removeSession } =
    useChat();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { sessionId: routeSid } = useParams();

  // Mirror the live sessionId in a ref so the URL→session effect below need not
  // depend on it (which would make it re-fire mid-conversation).
  const sidRef = useRef(sessionId);
  useEffect(() => {
    sidRef.current = sessionId;
  }, [sessionId]);

  // URL → session. /rolepilot/<id> opens that conversation; bare /rolepilot starts a
  // fresh one. We only reset to "new" when a persisted session is actually loaded
  // (sidRef set) so an in-flight/just-started chat is never clobbered.
  useEffect(() => {
    if (routeSid) {
      if (routeSid !== sidRef.current) void loadSession(routeSid);
    } else {
      // Bare /rolepilot = a fresh session. newChat() no-ops while a stream is in
      // flight, so this can't clobber an in-progress reply.
      newChat();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSid]);

  // session → URL. When a brand-new chat receives its server id, reflect it in the
  // address bar so the conversation is linkable and survives a reload.
  useEffect(() => {
    if (!routeSid && sessionId && !busy) {
      navigate(`/rolepilot/${sessionId}`, { replace: true });
    }
  }, [sessionId, routeSid, busy, navigate]);

  const openSession = (sid: string) => navigate(`/rolepilot/${sid}`);
  const goNew = () => navigate("/rolepilot");

  // keep view pinned to the latest message
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  useLayoutEffect(() => {
    setEnd(
      <Button size="sm" outlined prefix={<Plus className="size-4" />} onClick={() => navigate("/rolepilot")}>
        New chat
      </Button>,
    );
    return () => setEnd(null);
  }, [setEnd, navigate]);

  const submit = () => {
    if (!input.trim() || busy) return;
    send(input);
    setInput("");
  };

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 gap-6 pt-2 sm:pt-4">
      {/* sessions rail — glass rounded-3xl card */}
      <aside className="bg-card hidden w-64 shrink-0 flex-col rounded-3xl border border-border p-4 md:flex">
        <button
          className="mb-5 flex items-center justify-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/70 disabled:opacity-50"
          onClick={goNew}
          disabled={busy}
        >
          <ChatCircle className="size-4" /> New chat
        </button>
        <div className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-tertiary">
          Conversations
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-0.5">
          {sessions.length === 0 ? (
            <div className="px-2 text-xs italic text-text-tertiary">No saved chats yet.</div>
          ) : (
            sessions.map((s) => (
              <div
                key={s.session_id}
                className={`group flex items-center gap-2 rounded-xl border px-3 py-2.5 transition-colors ${
                  s.session_id === sessionId
                    ? "border-border bg-card ring-1 ring-accent/30"
                    : "border-transparent hover:bg-muted/40"
                }`}
              >
                <button
                  className="min-w-0 flex-1 text-left"
                  title={s.title}
                  onClick={() => openSession(s.session_id)}
                >
                  <p
                    className={`truncate text-sm ${
                      s.session_id === sessionId
                        ? "font-semibold text-foreground"
                        : "font-medium text-text-secondary group-hover:text-foreground"
                    }`}
                  >
                    {s.title}
                  </p>
                </button>
                <button
                  className="shrink-0 text-text-tertiary opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  title="Delete"
                  onClick={() => void removeSession(s.session_id)}
                >
                  <Trash className="size-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* chat column */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5">
        <div className="bg-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-border">
          <div
            ref={scrollRef}
            className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto p-6 sm:p-8"
          >
            {messages.length === 0 ? (
              <div className="m-auto flex max-w-md flex-col items-center gap-4 text-center">
                <span className="flex size-14 items-center justify-center rounded-2xl bg-accent/10">
                  <Sparkle className="size-7 text-accent" weight="duotone" />
                </span>
                <h2 className="text-xl font-semibold tracking-[-0.02em] text-foreground">
                  RolePilot
                </h2>
                <p className="text-sm leading-relaxed text-text-secondary">
                  Your RoleFit operator. Ask it to pull jobs, manage applicants,
                  classify profiles, or run analysis — it reasons, runs the work
                  itself, and only spends money or deletes data after you approve.
                  You'll see it think live.
                </p>
                <div className="mt-1 flex w-full flex-col gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      className="rounded-2xl border border-border bg-muted/30 px-4 py-3 text-left text-xs text-text-secondary transition-colors hover:border-accent/40 hover:text-foreground"
                      onClick={() => send(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <div className="bg-card max-w-[70%] rounded-2xl rounded-tr-md border border-border px-5 py-3.5 text-sm leading-relaxed text-foreground">
                      <div className="whitespace-pre-wrap">{m.text}</div>
                    </div>
                  </div>
                ) : (
                  <div key={i} className="flex items-start gap-4">
                    <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-white shadow-[var(--rf-e1)]">
                      <Robot className="size-5" weight="fill" />
                    </span>
                    <div className="flex min-w-0 max-w-[85%] flex-col gap-3">
                      {(m.activity?.length ?? 0) > 0 && (
                        <ThinkingBlock activity={m.activity!} live={!!m.live} />
                      )}
                      {m.text && (
                        <div className="text-sm leading-relaxed [&_table]:my-1 [&_table]:text-xs">
                          <Markdown content={m.text} />
                        </div>
                      )}
                      {m.live && (
                        <div className="flex items-center gap-2 text-xs text-text-tertiary">
                          <Spinner className="size-3" /> working…
                        </div>
                      )}
                    </div>
                  </div>
                ),
              )
            )}
          </div>

          {/* composer */}
          <div className="border-t border-border bg-muted/20 p-4 sm:p-5">
            <div className="relative mx-auto max-w-3xl">
              <textarea
                className="min-h-[52px] w-full resize-none rounded-[20px] border border-border bg-card/60 py-4 pl-5 pr-16 text-sm placeholder:text-muted-foreground transition-colors focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                placeholder="Message RolePilot…  (Enter to send, Shift+Enter for newline)"
                value={input}
                disabled={busy}
                rows={1}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              <button
                className="absolute right-2.5 top-2.5 flex size-10 items-center justify-center rounded-full bg-foreground text-background transition-all hover:brightness-110 active:scale-95 disabled:opacity-40"
                disabled={busy || !input.trim()}
                onClick={submit}
                title="Send"
                aria-label="Send message"
              >
                {busy ? <Spinner className="size-4" /> : <ArrowUp className="size-5" weight="bold" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
