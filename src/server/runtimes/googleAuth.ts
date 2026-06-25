import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

export interface GoogleServiceAccount {
  type?: string;
  project_id?: string;
  client_email?: string;
  private_key?: string;
  token_uri?: string;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

export interface AccessTokenCache {
  accessToken: string;
  expiresAtMs: number;
}

export async function readGoogleServiceAccount(credentialsPath: string): Promise<GoogleServiceAccount | null> {
  if (!credentialsPath) {
    return null;
  }

  try {
    const credentials = JSON.parse(await readFile(credentialsPath, "utf8")) as GoogleServiceAccount;
    if (credentials.type !== "service_account" || !credentials.client_email || !credentials.private_key) {
      return null;
    }

    return credentials;
  } catch {
    return null;
  }
}

export function googleUserProjectHeader(credentials: GoogleServiceAccount): Record<string, string> {
  return credentials.project_id ? { "x-goog-user-project": credentials.project_id } : {};
}

export async function getGoogleAccessToken(options: {
  credentials: GoogleServiceAccount;
  fetchImpl?: typeof fetch;
  now?: () => number;
  tokenCache?: AccessTokenCache | null;
}): Promise<{ token: string; tokenCache: AccessTokenCache | null }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  if (options.tokenCache && options.tokenCache.expiresAtMs - now() > 60_000) {
    return { token: options.tokenCache.accessToken, tokenCache: options.tokenCache };
  }

  const tokenUri = options.credentials.token_uri ?? "https://oauth2.googleapis.com/token";
  const nowSeconds = Math.floor(now() / 1000);
  const assertion = signJwt(
    {
      alg: "RS256",
      typ: "JWT",
    },
    {
      iss: options.credentials.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: tokenUri,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    },
    options.credentials.private_key ?? "",
  );

  const response = await fetchImpl(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    throw new Error(`Google OAuth token request failed with status ${response.status}`);
  }

  const body = (await response.json()) as TokenResponse;
  if (!body.access_token) {
    throw new Error("Google OAuth token response did not include access_token");
  }

  const tokenCache: AccessTokenCache = {
    accessToken: body.access_token,
    expiresAtMs: now() + Math.max(1, body.expires_in ?? 3600) * 1000,
  };

  return { token: body.access_token, tokenCache };
}

function signJwt(header: object, payload: object, privateKey: string): string {
  const unsigned = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(privateKey).toString("base64url");

  return `${unsigned}.${signature}`;
}

function base64UrlJson(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
