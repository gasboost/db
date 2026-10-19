import { NodeUtilities } from "@gasboost/fake-node";
import { generateKeyPairSync, verify } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FirebaseRtdbRestTransport,
  type RtdbUrlFetchApp,
} from "../src/FirebaseRtdbRestTransport";
import type { FirebaseServiceAccount } from "../src/FirebaseCustomToken";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const credentials: FirebaseServiceAccount = {
  email: "firebase-adminsdk@example.iam.gserviceaccount.com",
  privateKey,
};
const tokenEndpoint = "https://oauth2.googleapis.com/token";
const databaseUrl = "https://example.firebaseio.com";
const response = (body: unknown, status = 200) => ({
  getResponseCode: () => status,
  getContentText: () => JSON.stringify(body),
});

function setup() {
  const entries = new Map<string, { token: string; expiresAt: number }>();
  const cache = {
    get: vi.fn((key: string) => {
      const entry = entries.get(key);
      return entry && entry.expiresAt > Date.now() ? entry.token : null;
    }),
    put: vi.fn((key: string, token: string, ttl: number) => {
      entries.set(key, { token, expiresAt: Date.now() + ttl * 1000 });
    }),
  };
  const cacheService = { getScriptCache: vi.fn(() => cache) };
  const credentialsProvider = vi.fn(() => credentials);
  const fetch = vi.fn<RtdbUrlFetchApp["fetch"]>((url) =>
    url === tokenEndpoint
      ? response({ access_token: "access-token", expires_in: 3600 })
      : response({}),
  );
  const utilities = new NodeUtilities();
  const config = {
    databaseUrl,
    urlFetchApp: { fetch },
    cacheService,
    credentialsProvider,
    utilities,
  };
  return {
    cache,
    cacheService,
    credentialsProvider,
    fetch,
    config,
    transport: new FirebaseRtdbRestTransport(config),
  };
}

describe("FirebaseRtdbRestTransport service-account OAuth", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T05:00:00.123Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not read credentials or cache during construction", () => {
    const { cacheService, credentialsProvider, fetch } = setup();
    expect(cacheService.getScriptCache).not.toHaveBeenCalled();
    expect(credentialsProvider).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["actual newlines", privateKey],
    ["escaped newlines", privateKey.replace(/\n/g, "\\n")],
  ])("passes a normalized key to OAuth JWT signing with %s", (_, key) => {
    const { transport, config, credentialsProvider, fetch } = setup();
    const sign = vi.spyOn(config.utilities, "computeRsaSha256Signature");
    const account = { ...credentials, privateKey: key };
    credentialsProvider.mockReturnValue(account);

    transport.patch({});

    const form = new URLSearchParams(fetch.mock.calls[0][1].payload);
    const [header, payload] = form.get("assertion")!.split(".");
    expect(sign).toHaveBeenCalledExactlyOnceWith(
      `${header}.${payload}`,
      privateKey,
    );
    expect(account.privateKey).toBe(key);
  });

  it("exchanges a signed RS256 assertion and sends an authorized PATCH", () => {
    const { transport, fetch, cache, credentialsProvider } = setup();
    transport.patch({ "employees/e1": { id: "e1" } });
    expect(credentialsProvider).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe(tokenEndpoint);
    expect(options).toMatchObject({
      method: "post",
      contentType: "application/x-www-form-urlencoded",
      muteHttpExceptions: true,
    });
    const form = new URLSearchParams(options.payload);
    expect(form.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    );
    const assertion = form.get("assertion")!;
    const [header, payload, signature] = assertion.split(".");
    expect(assertion).not.toContain("=");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    const issuedAt = Math.floor(Date.now() / 1000);
    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toEqual({
      iss: credentials.email,
      aud: tokenEndpoint,
      scope:
        "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email",
      iat: issuedAt,
      exp: issuedAt + 3600,
    });
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(`${header}.${payload}`),
        publicKey,
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
    expect(cache.put).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("gasboost:realtime-firebase:"),
      "access-token",
      3540,
    );
    expect(fetch).toHaveBeenLastCalledWith(`${databaseUrl}/.json`, {
      method: "patch",
      contentType: "application/json",
      headers: { Authorization: "Bearer access-token" },
      payload: JSON.stringify({ "employees/e1": { id: "e1" } }),
      muteHttpExceptions: true,
    });
  });

  it("reuses script cache across instances without credentials or Utilities", () => {
    const { transport, config, credentialsProvider, fetch } = setup();
    transport.patch({});
    credentialsProvider.mockClear();
    fetch.mockClear();
    new FirebaseRtdbRestTransport({
      ...config,
      databaseUrl: `${databaseUrl}/`,
      utilities: undefined,
    }).patch({});
    expect(credentialsProvider).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      `${databaseUrl}/.json`,
      expect.objectContaining({
        headers: { Authorization: "Bearer access-token" },
      }),
    );
  });

  it("reads credentials again only after cached token expiration", () => {
    const { transport, credentialsProvider, fetch } = setup();
    transport.patch({});
    vi.advanceTimersByTime(3539 * 1000);
    transport.patch({});
    expect(credentialsProvider).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    transport.patch({});
    expect(credentialsProvider).toHaveBeenCalledTimes(2);
    expect(
      fetch.mock.calls.filter(([url]) => url === tokenEndpoint),
    ).toHaveLength(2);
  });

  it("isolates caches for different database URLs", () => {
    const { config, transport, credentialsProvider, cache } = setup();
    transport.patch({});
    new FirebaseRtdbRestTransport({
      ...config,
      databaseUrl: "https://other.firebaseio.com",
    }).patch({});
    expect(credentialsProvider).toHaveBeenCalledTimes(2);
    expect(cache.put.mock.calls[0][0]).not.toBe(cache.put.mock.calls[1][0]);
  });

  it("uses GAS Utilities by default on cache miss", () => {
    const { config } = setup();
    vi.stubGlobal("Utilities", config.utilities);
    expect(() =>
      new FirebaseRtdbRestTransport({ ...config, utilities: undefined }).patch(
        {},
      ),
    ).not.toThrow();
  });

  it.each([
    [120, 60],
    [3600, 3540],
    [86400, 21600],
  ])("caches expires_in=%s with TTL %s", (expires_in, ttl) => {
    const { transport, fetch, cache } = setup();
    fetch.mockReturnValueOnce(response({ access_token: "token", expires_in }));
    transport.patch({});
    expect(cache.put).toHaveBeenCalledWith(expect.any(String), "token", ttl);
  });

  it.each([1, 59, 60])(
    "does not cache very short-lived tokens (%s seconds)",
    (expires_in) => {
      const { transport, fetch, cache } = setup();
      fetch.mockReturnValueOnce(
        response({ access_token: "token", expires_in }),
      );
      transport.patch({});
      expect(cache.put).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenLastCalledWith(
        `${databaseUrl}/.json`,
        expect.objectContaining({ headers: { Authorization: "Bearer token" } }),
      );
    },
  );

  it("deducts OAuth request duration from cache TTL", () => {
    const { transport, fetch, cache } = setup();
    fetch.mockImplementationOnce(() => {
      vi.advanceTimersByTime(2500);
      return response({ access_token: "token", expires_in: 3600 });
    });
    transport.patch({});
    expect(cache.put).toHaveBeenCalledWith(expect.any(String), "token", 3537);
  });

  it("propagates OAuth HTTP failures without caching or patching", () => {
    const { transport, fetch, cache } = setup();
    fetch.mockReturnValueOnce(response({ error: "invalid_grant" }, 400));
    expect(() => transport.patch({})).toThrow(
      "OAuth token request failed (HTTP 400)",
    );
    expect(cache.put).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("propagates token endpoint network failures", () => {
    const { transport, fetch, cache } = setup();
    fetch.mockImplementationOnce(() => {
      throw new Error("network failed");
    });
    expect(() => transport.patch({})).toThrow("network failed");
    expect(cache.put).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    {},
    { access_token: "", expires_in: 3600 },
    { access_token: " ", expires_in: 3600 },
    { access_token: 123, expires_in: 3600 },
    { access_token: "token" },
    { access_token: "token", expires_in: "3600" },
    { access_token: "token", expires_in: 0 },
    { access_token: "token", expires_in: -1 },
  ])("rejects invalid OAuth response: %j", (body) => {
    const { transport, fetch, cache } = setup();
    fetch.mockReturnValueOnce(response(body));
    expect(() => transport.patch({})).toThrow(
      "must contain access_token and positive expires_in",
    );
    expect(cache.put).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed JSON from the token endpoint", () => {
    const { transport, fetch, cache } = setup();
    fetch.mockReturnValueOnce({
      getResponseCode: () => 200,
      getContentText: () => "not JSON",
    });
    expect(() => transport.patch({})).toThrow(
      "OAuth token response is not valid JSON",
    );
    expect(cache.put).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("propagates credential-provider failures", () => {
    const { transport, credentialsProvider, fetch } = setup();
    credentialsProvider.mockImplementation(() => {
      throw new Error("credentials unavailable");
    });
    expect(() => transport.patch({})).toThrow("credentials unavailable");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { ...credentials, email: " " },
    { ...credentials, privateKey: " " },
  ])("rejects empty credentials", (account) => {
    const { transport, credentialsProvider, fetch } = setup();
    credentialsProvider.mockReturnValue(account);
    expect(() => transport.patch({})).toThrow(
      "email and private key must not be empty",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
