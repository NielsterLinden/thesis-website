import { ChatMessage, ChatResponse, SiteMeta } from './types';

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

export async function fetchMeta(): Promise<SiteMeta | null> {
  try {
    const res = await fetch('/meta');
    if (!res.ok) return null;
    return (await res.json()) as SiteMeta;
  } catch {
    return null;
  }
}
