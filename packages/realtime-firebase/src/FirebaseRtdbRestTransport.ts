import type {
  FirebaseCustomTokenUtilities,
  FirebaseServiceAccount,
} from "./FirebaseCustomToken";

export type RtdbUpdates = Readonly<Record<string, unknown>>;

export interface RtdbTransport {
  patch(updates: RtdbUpdates): void;
}

/** Structural subset of UrlFetchApp; no GAS ambient types are required by consumers. */
export interface RtdbUrlFetchApp {
  fetch(
    url: string,
    options: {
      method: "patch" | "post";
      contentType: string;
      headers: Record<string, string>;
      payload: string;
      muteHttpExceptions: boolean;
    },
  ): {
    getResponseCode(): number;
    getContentText(): string;
  };
}

/** Structural subset of CacheService, also usable by non-GAS test doubles. */
export interface RtdbCacheService {
  getScriptCache(): {
    get(key: string): string | null;
    put(key: string, value: string, expirationInSeconds: number): void;
  };
}

export type FirebaseRtdbRestTransportConfig = {
  readonly databaseUrl: string;
  readonly urlFetchApp: RtdbUrlFetchApp;
  readonly cacheService: RtdbCacheService;
  readonly credentialsProvider: () => FirebaseServiceAccount;
  /** Defaults to GAS Utilities; injectable for non-GAS environments. */
  readonly utilities?: FirebaseCustomTokenUtilities;
};

/** Synchronous root multi-location PATCH using a Firebase-authorized OAuth token. */
export class FirebaseRtdbRestTransport implements RtdbTransport {
  private static readonly TOKEN_ENDPOINT =
    "https://oauth2.googleapis.com/token";

  constructor(private readonly config: FirebaseRtdbRestTransportConfig) {}

  patch(updates: RtdbUpdates): void {
    const url = this.config.databaseUrl.replace(/\/+$/, "");
    const response = this.config.urlFetchApp.fetch(`${url}/.json`, {
      method: "patch",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${this.getAccessToken(url)}` },
      payload: JSON.stringify(updates),
      muteHttpExceptions: true,
    });
    const status = response.getResponseCode();
    if (status < 200 || status >= 300) {
      throw new Error(
        `Firebase RTDB PATCH failed (HTTP ${status}): ${response.getContentText()}`,
      );
    }
  }

  private getAccessToken(databaseUrl: string): string {
    const cache = this.config.cacheService.getScriptCache();
    // A script uses one service-account identity per database. Include the URL
    // so independent databases do not accidentally share authorization.
    const cacheKey = `gasboost:realtime-firebase:oauth:v1:${databaseUrl}`;
    const cachedToken = cache.get(cacheKey);
    if (cachedToken) return cachedToken;

    const serviceAccount = this.config.credentialsProvider();
    if (!serviceAccount.email.trim() || !serviceAccount.privateKey.trim()) {
      throw new Error(
        "Firebase service account email and private key must not be empty",
      );
    }
    const utilities = this.config.utilities ?? Utilities;
    const encode = (data: string | ArrayLike<number>): string =>
      utilities.base64EncodeWebSafe(data).replace(/=+$/u, "");
    const issuedAt = Math.floor(Date.now() / 1000);
    const header = encode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = encode(
      JSON.stringify({
        iss: serviceAccount.email,
        scope:
          "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email",
        aud: FirebaseRtdbRestTransport.TOKEN_ENDPOINT,
        iat: issuedAt,
        exp: issuedAt + 3600,
      }),
    );
    const unsignedToken = `${header}.${payload}`;
    const signature = encode(
      utilities.computeRsaSha256Signature(
        unsignedToken,
        serviceAccount.privateKey,
      ),
    );
    const requestStartedAt = Date.now();
    const response = this.config.urlFetchApp.fetch(
      FirebaseRtdbRestTransport.TOKEN_ENDPOINT,
      {
        method: "post",
        contentType: "application/x-www-form-urlencoded",
        headers: {},
        payload: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${encodeURIComponent(`${unsignedToken}.${signature}`)}`,
        muteHttpExceptions: true,
      },
    );
    const status = response.getResponseCode();
    if (status < 200 || status >= 300) {
      throw new Error(
        `Firebase RTDB OAuth token request failed (HTTP ${status}): ${response.getContentText()}`,
      );
    }
    let token: unknown;
    try {
      token = JSON.parse(response.getContentText());
    } catch {
      throw new Error("Firebase RTDB OAuth token response is not valid JSON");
    }
    if (
      typeof token !== "object" ||
      token === null ||
      !("access_token" in token) ||
      typeof token.access_token !== "string" ||
      !token.access_token.trim() ||
      !("expires_in" in token) ||
      typeof token.expires_in !== "number" ||
      !Number.isFinite(token.expires_in) ||
      token.expires_in <= 0
    ) {
      throw new Error(
        "Firebase RTDB OAuth token response must contain access_token and positive expires_in",
      );
    }
    // Account for request duration, leave a safety margin, and respect GAS's
    // maximum CacheService TTL (6 hours). Very short-lived tokens are not cached.
    const ttl = Math.min(
      21600,
      Math.floor(
        token.expires_in - (Date.now() - requestStartedAt) / 1000 - 60,
      ),
    );
    if (ttl > 0) cache.put(cacheKey, token.access_token, ttl);
    return token.access_token;
  }
}
