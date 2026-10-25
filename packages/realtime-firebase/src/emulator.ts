import type {
  RtdbTransport,
  RtdbUpdates,
  RtdbUrlFetchApp,
} from "./FirebaseRtdbRestTransport";

export type { RtdbTransport, RtdbUpdates, RtdbUrlFetchApp };

export type FirebaseRtdbEmulatorTransportConfig = {
  /** RTDB namespace, rather than a database URL or project ID. */
  readonly databaseName: string;
  readonly urlFetchApp: RtdbUrlFetchApp;
  /** Loopback host only. Defaults to 127.0.0.1. */
  readonly host?: string;
  /** Defaults to 9000. */
  readonly port?: number;
};

/** Synchronous admin PATCH for a local RTDB Emulator. Test backend use only. */
export class FirebaseRtdbEmulatorTransport implements RtdbTransport {
  private readonly url: string;
  private readonly urlFetchApp: RtdbUrlFetchApp;

  constructor(config: FirebaseRtdbEmulatorTransportConfig) {
    if (!config.databaseName.trim()) {
      throw new Error("Firebase RTDB Emulator databaseName must not be empty");
    }
    const host = config.host ?? "127.0.0.1";
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
      throw new Error("Firebase RTDB Emulator host must be a loopback host");
    }
    const port = config.port ?? 9000;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Firebase RTDB Emulator port must be an integer from 1 to 65535");
    }
    const authority = host === "::1" ? "[::1]" : host;
    this.url = `http://${authority}:${port}/.json?ns=${encodeURIComponent(config.databaseName)}`;
    this.urlFetchApp = config.urlFetchApp;
  }

  patch(updates: RtdbUpdates): void {
    const options = {
      method: "patch" as const,
      contentType: "application/json",
      headers: { Authorization: "Bearer owner" },
      payload: JSON.stringify(updates),
      muteHttpExceptions: true,
      // Never forward emulator admin credentials to a redirected destination.
      followRedirects: false,
    };
    const response = this.urlFetchApp.fetch(this.url, options);
    const status = response.getResponseCode();
    if (status < 200 || status >= 300) {
      throw new Error(
        `Firebase RTDB Emulator PATCH failed (HTTP ${status}): ${response.getContentText()}`,
      );
    }
  }
}
