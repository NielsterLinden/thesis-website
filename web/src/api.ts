import { ChatMessage, ChatResponse, SiteMeta, ThesisAnchors } from './types';

const PASSWORD_KEY = 'site_password';
const PASSWORD_HEADER = 'x-site-password';

export function getStoredPassword(): string | null {
  return sessionStorage.getItem(PASSWORD_KEY);
}

export function storePassword(pw: string): void {
  sessionStorage.setItem(PASSWORD_KEY, pw);
}

export function clearStoredPassword(): void {
  sessionStorage.removeItem(PASSWORD_KEY);
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function bodyMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { message?: string | string[] };
    const m = data.message;
    return Array.isArray(m) ? m.join('; ') : (m ?? res.statusText);
  } catch {
    return res.statusText;
  }
}

/** POST /auth/check — verifies the password without a paid model call. */
export async function checkPassword(pw: string): Promise<void> {
  const res = await fetch('/auth/check', {
    method: 'POST',
    headers: { [PASSWORD_HEADER]: pw },
  });
  if (!res.ok) throw new ApiError(res.status, await bodyMessage(res));
}

/** POST /chat — the stateless agent turn; the full history goes up each time. */
export async function postChat(messages: ChatMessage[], pw: string): Promise<ChatResponse> {
  const res = await fetch('/chat', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [PASSWORD_HEADER]: pw,
    },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) throw new ApiError(res.status, await bodyMessage(res));
  return (await res.json()) as ChatResponse;
}

/** POST /reports/save — call 2 of the confirm protocol: the human clicked
 *  Confirm, the validated spec goes back, the server re-validates and saves a
 *  DRAFT W&B report. Returns the draft URL. */
export async function saveReport(spec: unknown, pw: string): Promise<{ url: string }> {
  const res = await fetch('/reports/save', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [PASSWORD_HEADER]: pw,
    },
    body: JSON.stringify({ spec }),
  });
  if (!res.ok) throw new ApiError(res.status, await bodyMessage(res));
  return (await res.json()) as { url: string };
}

/** One progress line per tool dispatch, streamed while the agent works. */
export interface ChatProgressEvent {
  type: 'tool_start';
  name: string;
  detail: string;
}

type StreamLine =
  | ChatProgressEvent
  | { type: 'final'; result: ChatResponse }
  | { type: 'error'; message: string };

/** POST /chat/stream — same turn as postChat, but tool-progress events arrive
 *  live (ndjson lines) so the UI can narrate what the agent is doing. Falls
 *  back to plain postChat against a backend without the route. */
export async function postChatStream(
  messages: ChatMessage[],
  pw: string,
  onProgress: (event: ChatProgressEvent) => void,
): Promise<ChatResponse> {
  const res = await fetch('/chat/stream', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [PASSWORD_HEADER]: pw,
    },
    body: JSON.stringify({ messages }),
  });
  if (res.status === 404 || res.status === 405) return postChat(messages, pw);
  if (!res.ok) throw new ApiError(res.status, await bodyMessage(res));
  if (!res.body) return postChat(messages, pw);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let final: ChatResponse | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let event: StreamLine;
      try {
        event = JSON.parse(line) as StreamLine;
      } catch {
        continue;
      }
      if (event.type === 'final') final = event.result;
      else if (event.type === 'error') throw new ApiError(502, event.message);
      else if (event.type === 'tool_start') onProgress(event);
    }
  }
  if (!final) throw new ApiError(502, 'The answer stream ended unexpectedly. Please try again.');
  return final;
}

export async function fetchMeta(): Promise<SiteMeta | null> {
  try {
    const res = await fetch('/meta');
    if (!res.ok) return null;
    return (await res.json()) as SiteMeta;
  } catch {
    return null;
  }
}

/** GET /thesis-anchors.json — the [thesis: …] deep-link map. Null (no deep
 *  links, chips fall back to opening the PDF at page 1) on any failure. */
export async function fetchThesisAnchors(): Promise<ThesisAnchors | null> {
  try {
    const res = await fetch('/thesis-anchors.json');
    if (!res.ok) return null;
    return (await res.json()) as ThesisAnchors;
  } catch {
    return null;
  }
}
