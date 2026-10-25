import { describe, expect, it, vi } from "vitest";
import { FirebaseRtdb, PropertiesVersionStore } from "../src";
import {
  FirebaseRtdbEmulatorTransport,
  type FirebaseRtdbEmulatorTransportConfig,
  type RtdbUrlFetchApp,
} from "../src/emulator";

function setup(overrides: Partial<FirebaseRtdbEmulatorTransportConfig> = {}) {
  const fetch = vi.fn<RtdbUrlFetchApp["fetch"]>(() => ({
    getResponseCode: () => 200,
    getContentText: () => "{}",
  }));
  const transport = new FirebaseRtdbEmulatorTransport({
    databaseName: "demo-pos-default-rtdb",
    urlFetchApp: { fetch },
    ...overrides,
  });
  return { fetch, transport };
}

describe("FirebaseRtdbEmulatorTransport", () => {
  it("sends one synchronous root PATCH without OAuth or GAS globals", () => {
    const { fetch, transport } = setup();
    const updates = { "syncVersions/employees": 42, "unchanged/path": { value: null } };
    expect(transport.patch(updates)).toBeUndefined();
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "http://127.0.0.1:9000/.json?ns=demo-pos-default-rtdb",
      {
        method: "patch",
        contentType: "application/json",
        headers: { Authorization: "Bearer owner" },
        payload: JSON.stringify(updates),
        muteHttpExceptions: true,
        followRedirects: false,
      },
    );
  });

  it("encodes the namespace without changing it", () => {
    const { fetch, transport } = setup({ databaseName: "demo /日本語?&ns=other" });
    transport.patch({});
    expect(fetch.mock.calls[0][0]).toBe(
      `http://127.0.0.1:9000/.json?ns=${encodeURIComponent("demo /日本語?&ns=other")}`,
    );
  });

  it.each(["localhost", "::1", "[::1]"])("supports local host %s and a custom port", (host) => {
    const { fetch, transport } = setup({ host, port: 9001 });
    transport.patch({});
    expect(fetch.mock.calls[0][0]).toBe(
      `http://${host === "::1" ? "[::1]" : host}:9001/.json?ns=demo-pos-default-rtdb`,
    );
  });

  it.each(["", "   "])("rejects an empty namespace %j", (databaseName) => {
    expect(() => setup({ databaseName })).toThrow("databaseName must not be empty");
  });

  it.each(["example.firebaseio.com", "https://localhost", "localhost/path", "localhost@remote.test", ""])(
    "rejects non-local or malformed host %j", (host) => {
      expect(() => setup({ host })).toThrow("host must be a loopback host");
    },
  );

  it.each([0, -1, 65536, 9000.5, NaN, Infinity])("rejects invalid port %s", (port) => {
    expect(() => setup({ port })).toThrow("port must be an integer");
  });

  it.each([200, 204, 299])("accepts HTTP %s", (status) => {
    const { fetch, transport } = setup();
    fetch.mockReturnValue({ getResponseCode: () => status, getContentText: () => "" });
    expect(() => transport.patch({})).not.toThrow();
  });

  it.each([199, 302, 401, 500])("propagates HTTP %s and the response body", (status) => {
    const { fetch, transport } = setup();
    fetch.mockReturnValue({ getResponseCode: () => status, getContentText: () => "emulator error" });
    expect(() => transport.patch({})).toThrow(`HTTP ${status}): emulator error`);
  });

  it("propagates the original fetch exception", () => {
    const { fetch, transport } = setup();
    const error = new Error("connection refused");
    fetch.mockImplementation(() => { throw error; });
    expect(() => transport.patch({})).toThrow(error);
  });

  it("publishes version notifications through the existing FirebaseRtdb", () => {
    const { fetch, transport } = setup();
    const properties = new Map<string, string>();
    const rtdb = new FirebaseRtdb({
      transport,
      versionStore: new PropertiesVersionStore({
        getProperty: (key) => properties.get(key) ?? null,
        setProperty: (key, value) => properties.set(key, value),
      }),
    });
    rtdb.publish([{ table: "employees" }]);
    rtdb.publish([{ table: "employees" }]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([, options]) => JSON.parse(options.payload))).toEqual([
      { "syncVersions/employees": 1 },
      { "syncVersions/employees": 2 },
    ]);
  });
});
