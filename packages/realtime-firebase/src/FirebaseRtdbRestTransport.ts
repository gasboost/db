export type RtdbUpdates = Readonly<Record<string, unknown>>;

export interface RtdbTransport {
  patch(updates: RtdbUpdates): void;
}

/** Structural subset of UrlFetchApp; no GAS ambient types are required by consumers. */
export interface RtdbUrlFetchApp {
  fetch(
    url: string,
    options: {
      method: "patch";
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

export type FirebaseRtdbRestTransportConfig = {
  readonly databaseUrl: string;
  readonly urlFetchApp: RtdbUrlFetchApp;
  readonly getAccessToken: () => string;
};

/** Synchronous root multi-location PATCH using a Firebase-authorized OAuth token. */
export class FirebaseRtdbRestTransport implements RtdbTransport {
  constructor(private readonly config: FirebaseRtdbRestTransportConfig) {}

  patch(updates: RtdbUpdates): void {
    const url = this.config.databaseUrl.replace(/\/+$/, "");
    const response = this.config.urlFetchApp.fetch(`${url}/.json`, {
      method: "patch",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${this.config.getAccessToken()}` },
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
}
