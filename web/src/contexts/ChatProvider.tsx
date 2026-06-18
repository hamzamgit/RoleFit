import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  agentChatStream, rolefit, type AgentEvent, type ChatSession,
} from "@/lib/rolefit-api";
import { ChatContext, type Activity, type Msg } from "@/contexts/chat-context";

const ACTIVE_KEY = "rolefit.activeSession";
// v2 so any stale completed-chat cache from the old behaviour is ignored.
const LIVE_KEY = "rolefit.liveChat2";

function clearLive() {
  try {
    sessionStorage.removeItem(LIVE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * App-level chat state. Mounted above <Routes>, so it does NOT unmount when the
 * user switches dashboard tabs — an in-progress agent turn keeps streaming and
 * the transcript stays intact when they return to the Setup Agent page.
 */
export function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [busy, setBusy] = useState(false);
  const startedRef = useRef(false);

  const refreshSessions = useCallback(async () => {
    try {
      const s = await rolefit.chatSessions();
      setSessions(s);
      return s;
    } catch {
      return [];
    }
  }, []);

  const loadSession = useCallback(async (sid: string) => {
    setSessionId(sid);
    try {
      localStorage.setItem(ACTIVE_KEY, sid);
    } catch {
      /* ignore */
    }
    try {
      const msgs = await rolefit.chatMessages(sid);
      setMessages(msgs.map((m) => ({ role: m.role, text: m.text })));
    } catch {
      setMessages([]);
    }
  }, []);

  const newChat = useCallback(() => {
    if (busy) return;
    setSessionId(null);
    setMessages([]);
    clearLive();
    try {
      localStorage.removeItem(ACTIVE_KEY);
    } catch {
      /* ignore */
    }
  }, [busy]);

  const removeSession = useCallback(
    async (sid: string) => {
      await rolefit.deleteChatSession(sid);
      if (sid === sessionId) newChat();
      void refreshSessions();
    },
    [sessionId, newChat, refreshSessions],
  );

  // Persist the live transcript ONLY while a turn is in flight, so a mid-stream
  // reload restores it. Once the turn completes (not busy) the cache is cleared —
  // completed chats live server-side, not here.
  // IMPORTANT: do nothing until the one-time restore below has run, otherwise on
  // a fresh reload this effect would wipe the cached in-flight chat (busy=false,
  // messages=[]) before the restore effect can read it.
  useEffect(() => {
    if (!startedRef.current) return;
    try {
      if (busy && messages.length) {
        sessionStorage.setItem(LIVE_KEY, JSON.stringify({ messages, sessionId }));
      } else {
        sessionStorage.removeItem(LIVE_KEY);
      }
    } catch {
      /* ignore */
    }
  }, [messages, sessionId, busy]);

  // One-time restore when the app boots: prefer an in-flight live transcript
  // (sessionStorage), else the last saved conversation (server).
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void refreshSessions();
    try {
      const live = sessionStorage.getItem(LIVE_KEY);
      if (live) {
        const parsed = JSON.parse(live) as { messages: Msg[]; sessionId: string | null };
        if (parsed.messages?.length) {
          // any message left "live" can't still be streaming after a reload
          setMessages(parsed.messages.map((m) => ({ ...m, live: false })));
          setSessionId(parsed.sessionId ?? null);
          return;
        }
      }
    } catch {
      /* ignore */
    }
    // No boot-time auto-load of the last conversation: the URL (/maestro vs
    // /maestro/<id>) is the source of truth for which session is shown, handled
    // by SetupChatPage. We only need the session list for the rail.
    void refreshSessions();
  }, [refreshSessions]);

  const send = useCallback(
    (text: string) => {
      const msg = text.trim();
      if (!msg || busy) return;
      setBusy(true);
      setMessages((m) => [
        ...m,
        { role: "user", text: msg },
        { role: "agent", text: "", activity: [], live: true },
      ]);

      const patchLast = (fn: (m: Msg) => Msg) =>
        setMessages((arr) => {
          const next = [...arr];
          next[next.length - 1] = fn(next[next.length - 1]);
          return next;
        });

      const onEvent = (e: AgentEvent) => {
        if (e.type === "done") {
          if (e.session_id) {
            setSessionId(e.session_id);
            try {
              localStorage.setItem(ACTIVE_KEY, e.session_id);
            } catch {
              /* ignore */
            }
          }
          patchLast((m) => ({ ...m, live: false }));
          void refreshSessions();
        } else if (e.type === "answer") {
          patchLast((m) => ({ ...m, text: (m.text ? m.text + "\n" : "") + (e.text ?? "") }));
        } else {
          patchLast((m) => ({
            ...m,
            activity: [
              ...(m.activity ?? []),
              { kind: e.type as Activity["kind"], text: e.text ?? "" },
            ],
          }));
        }
      };

      // sessionId captured at call time so resumes continue the right thread
      agentChatStream(msg, sessionId, onEvent)
        .catch((e) =>
          patchLast((m) => ({
            ...m,
            live: false,
            text: `Error: ${e instanceof Error ? e.message : String(e)}`,
          })),
        )
        .finally(() => setBusy(false));
    },
    [busy, sessionId, refreshSessions],
  );

  return (
    <ChatContext.Provider
      value={{ messages, sessionId, sessions, busy, send, loadSession, newChat, removeSession }}
    >
      {children}
    </ChatContext.Provider>
  );
}
