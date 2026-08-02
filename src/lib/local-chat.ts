// Local-only storage for conversations and messages (device memory, no account needed).
export type LocalCorrection = { wrong: string; correct: string; hint: string };

export type LocalMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  language: string;
  correction: LocalCorrection | null;
  created_at: string;
};

export type LocalConversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

const CONVOS_KEY = "cf-conversations";
const MSGS_PREFIX = "cf-messages-";

function canStore() {
  return typeof window !== "undefined" && !!window.localStorage;
}

function read<T>(key: string, fallback: T): T {
  if (!canStore()) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  if (!canStore()) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or unavailable — ignore
  }
}

export function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function listConversations(): LocalConversation[] {
  return read<LocalConversation[]>(CONVOS_KEY, []).sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );
}

export function createConversation(title: string): LocalConversation {
  const now = new Date().toISOString();
  const convo: LocalConversation = { id: newId(), title, created_at: now, updated_at: now };
  write(CONVOS_KEY, [convo, ...read<LocalConversation[]>(CONVOS_KEY, [])]);
  write(MSGS_PREFIX + convo.id, []);
  return convo;
}

export function deleteConversation(id: string) {
  write(CONVOS_KEY, read<LocalConversation[]>(CONVOS_KEY, []).filter((c) => c.id !== id));
  if (canStore()) {
    try { localStorage.removeItem(MSGS_PREFIX + id); } catch {}
  }
}

export function renameConversation(id: string, title: string) {
  write(
    CONVOS_KEY,
    read<LocalConversation[]>(CONVOS_KEY, []).map((c) => (c.id === id ? { ...c, title } : c)),
  );
}

export function getConversation(id: string): LocalConversation | null {
  return read<LocalConversation[]>(CONVOS_KEY, []).find((c) => c.id === id) ?? null;
}

export function listMessages(conversationId: string): LocalMessage[] {
  return read<LocalMessage[]>(MSGS_PREFIX + conversationId, []);
}

export function appendMessage(
  conversationId: string,
  msg: Omit<LocalMessage, "id" | "created_at"> & Partial<Pick<LocalMessage, "id" | "created_at">>,
): LocalMessage {
  const full: LocalMessage = {
    id: msg.id ?? newId(),
    created_at: msg.created_at ?? new Date().toISOString(),
    role: msg.role,
    content: msg.content,
    language: msg.language,
    correction: msg.correction ?? null,
  };
  write(MSGS_PREFIX + conversationId, [...listMessages(conversationId), full]);
  touchConversation(conversationId);
  return full;
}

export function touchConversation(id: string) {
  const now = new Date().toISOString();
  write(
    CONVOS_KEY,
    read<LocalConversation[]>(CONVOS_KEY, []).map((c) => (c.id === id ? { ...c, updated_at: now } : c)),
  );
}
