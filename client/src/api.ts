export class ApiError extends Error {
  status: number;
  /**
   * Der geparste Fehlerkörper, sofern die Antwort einen hatte. Meist reicht
   * `message`; ein 409 aus dem Wiki bringt aber den konkurrierenden Text mit,
   * und den will der Aufrufer sehen, nicht nur „konflikt".
   */
  data?: unknown;
  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

// Läuft die Sitzung ab, meldet der Server 401 — die App hängt sich hier ein,
// um sauber zur Anmeldung zurückzukehren statt still Speicherfehler zu zeigen.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401 && !path.endsWith('/login')) onUnauthorized?.();
  if (!res.ok) {
    let message = res.statusText;
    let body: unknown;
    try {
      body = await res.json();
      const data = body as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // Antwort ohne JSON-Körper
    }
    throw new ApiError(res.status, message, body);
  }
  return (await res.json()) as T;
}

export const apiGet = <T>(path: string) => request<T>('GET', path);
export const apiPost = <T>(path: string, body?: unknown) => request<T>('POST', path, body);
export const apiPut = <T>(path: string, body?: unknown) => request<T>('PUT', path, body);
export const apiDelete = <T>(path: string) => request<T>('DELETE', path);
