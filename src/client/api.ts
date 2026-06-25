let adminTokenMemory = "";

export function apiPath(path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path;
  }

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  if (!basePath) {
    return path;
  }

  return path.startsWith("/") ? `${basePath}${path}` : `${basePath}/${path}`;
}

export function getAdminToken(): string {
  return storage()?.getItem("lipivoice_admin_token") ?? adminTokenMemory;
}

export function setAdminToken(token: string): void {
  adminTokenMemory = token.trim();
  const localStorage = storage();
  if (!localStorage) {
    return;
  }

  if (adminTokenMemory) {
    localStorage.setItem("lipivoice_admin_token", adminTokenMemory);
    return;
  }

  localStorage.removeItem("lipivoice_admin_token");
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(apiPath(path), {
    headers: authHeaders(),
  });
  if (!response.ok) {
    const message = await parseApiError(response);
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(apiPath(path), {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const message = await parseApiError(response);
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(apiPath(path), {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const message = await parseApiError(response);
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export function authHeaders(): Record<string, string> {
  const token = getAdminToken();

  return token ? { authorization: `Bearer ${token}` } : {};
}

function storage(): Storage | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  return window.localStorage;
}

async function parseApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { code?: unknown; message?: unknown };

    if (typeof body.code === "string" && body.code.trim().length > 0) {
      return body.code;
    }

    if (typeof body.message === "string" && body.message.trim().length > 0) {
      return body.message;
    }
  } catch {
    // Ignore JSON parse failures; fall through to status-based error.
  }

  return `Request failed: ${response.status}`;
}
