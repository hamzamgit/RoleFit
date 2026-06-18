import { createContext, useContext } from "react";

export interface Activity {
  kind: "thinking" | "cmd" | "tool_done" | "status";
  text: string;
}
export interface Msg {
  role: "user" | "agent";
  text: string;
  activity?: Activity[];
  live?: boolean;
}

export interface ChatState {
  messages: Msg[];
  sessionId: string | null;
  sessions: import("@/lib/rolefit-api").ChatSession[];
  busy: boolean;
  send: (text: string) => void;
  loadSession: (sid: string) => void;
  newChat: () => void;
  removeSession: (sid: string) => void;
}

export const ChatContext = createContext<ChatState | null>(null);

export function useChat(): ChatState {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}
