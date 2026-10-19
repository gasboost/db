import { describe, expect, it, vi } from "vitest";
import {
  FirebaseRtdb,
  FirebaseRtdbRestTransport,
  PropertiesVersionStore,
  type VersionStore,
} from "../src";

const before = { id: "e1", name: "first", ownerId: "alice" };
const after = { ...before, name: "last" };
function versions() {
  const counters = new Map<string, number>();
  return {
    next: vi.fn((name: string) => {
      const next = (counters.get(name) ?? 0) + 1;
      counters.set(name, next);
      return next;
    }),
  };
}
function setup() {
  const versionStore = versions();
  const transport = { patch: vi.fn() };
  return {
    rtdb: new FirebaseRtdb({ versionStore, transport }),
    transport,
    versionStore,
  };
}

describe("version stores", () => {
  it("persists monotonic versions per table across instances", () => {
    const saved = new Map<string, string>();
    const properties = {
      getProperty: (key: string) => saved.get(key) ?? null,
      setProperty: vi.fn((key: string, value: string) => {
        saved.set(key, value);
      }),
    } as unknown as GoogleAppsScript.Properties.Properties;
    expect(new PropertiesVersionStore(properties).next("employees")).toBe(1);
    expect(new PropertiesVersionStore(properties).next("employees")).toBe(2);
    expect(new PropertiesVersionStore(properties).next("departments")).toBe(1);
    expect(saved.get("rtdb:version:employees")).toBe("2");
  });
  it.each(["bad", "", "-1", "0.5", String(Number.MAX_SAFE_INTEGER)])(
    "rejects corrupt/exhausted stored versions: %s",
    (raw) => {
      const setProperty = vi.fn();
      const properties = {
        getProperty: () => raw,
        setProperty,
      } as unknown as GoogleAppsScript.Properties.Properties;
      expect(() =>
        new PropertiesVersionStore(properties).next("employees"),
      ).toThrow();
      expect(setProperty).not.toHaveBeenCalled();
    },
  );
});

describe("FirebaseRtdb.publish", () => {
  it.each([
    { table: "employees", before: null, after },
    { table: "employees", before, after },
    { table: "employees", before, after: null },
  ])("publishes only the table Version for CRUD: %j", (change) => {
    const { rtdb, transport, versionStore } = setup();
    rtdb.publish([change]);
    expect(versionStore.next).toHaveBeenCalledExactlyOnceWith("employees");
    expect(transport.patch).toHaveBeenCalledExactlyOnceWith({
      "syncVersions/employees": 1,
    });
  });

  it("does nothing for an empty commit", () => {
    const { rtdb, transport, versionStore } = setup();
    rtdb.publish([]);
    expect(versionStore.next).not.toHaveBeenCalled();
    expect(transport.patch).not.toHaveBeenCalled();
  });

  it("allocates once for multiple changes in the same table", () => {
    const { rtdb, transport, versionStore } = setup();
    const changes = [
      { table: "employees", before, after },
      { table: "employees", before: null, after: { ...after, id: "e2" } },
      { table: "employees", before: { ...before, id: "e3" }, after: null },
    ];
    rtdb.publish(changes);
    expect(versionStore.next).toHaveBeenCalledExactlyOnceWith("employees");
    expect(transport.patch).toHaveBeenCalledExactlyOnceWith({
      "syncVersions/employees": 1,
    });
  });

  it("publishes multiple table Versions in one PATCH without table definitions", () => {
    const { rtdb, transport, versionStore } = setup();
    rtdb.publish([
      { table: "employees" },
      { table: "departments" },
      { table: "employees" },
    ]);
    expect(versionStore.next.mock.calls).toEqual([
      ["employees"],
      ["departments"],
    ]);
    expect(transport.patch).toHaveBeenCalledExactlyOnceWith({
      "syncVersions/employees": 1,
      "syncVersions/departments": 1,
    });
  });

  it("does not mutate frozen changes", () => {
    const { rtdb } = setup();
    const change = Object.freeze({
      table: "employees",
      before: Object.freeze(before),
      after: Object.freeze(after),
    });
    rtdb.publish(Object.freeze([change]));
    expect(change.after).toEqual(after);
  });

  it("propagates PATCH failure and publishes the next Version on retry", () => {
    const { rtdb, transport } = setup();
    const changes = [{ table: "employees", before, after }];
    transport.patch.mockImplementationOnce(() => {
      throw new Error("offline");
    });
    expect(() => rtdb.publish(changes)).toThrow("offline");
    rtdb.publish(changes);
    expect(transport.patch.mock.calls[1][0]).toEqual({
      "syncVersions/employees": 2,
    });
  });

  it("propagates VersionStore failure without sending PATCH", () => {
    const transport = { patch: vi.fn() };
    const versionStore: VersionStore = {
      next: () => {
        throw new Error("properties failed");
      },
    };
    const rtdb = new FirebaseRtdb({ transport, versionStore });
    expect(() => rtdb.publish([{ table: "employees" }])).toThrow("properties failed");
    expect(transport.patch).not.toHaveBeenCalled();
  });

  it("allows only authenticated notification reads and denies all client writes", () => {
    const { rtdb } = setup();
    expect(rtdb.rules()).toEqual({
      rules: {
        ".read": false,
        ".write": false,
        syncVersions: { ".read": "auth != null" },
      },
    });
  });
});

describe("REST transport", () => {
  it("sends one synchronous authorized PATCH to the database root", () => {
    const fetch = vi.fn(() => ({
      getResponseCode: () => 200,
      getContentText: () => "{}",
    }));
    const credentialsProvider = vi.fn();
    const transport = new FirebaseRtdbRestTransport({
      databaseUrl: "https://example.firebaseio.com/",
      urlFetchApp: {
        fetch,
      } as unknown as GoogleAppsScript.URL_Fetch.UrlFetchApp,
      credentialsProvider,
      cacheService: {
        getScriptCache: () => ({ get: () => "token", put: vi.fn() }),
      },
    });
    transport.patch({
      "syncVersions/employees": 1,
    });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "https://example.firebaseio.com/.json",
      {
        method: "patch",
        contentType: "application/json",
        headers: { Authorization: "Bearer token" },
        payload: JSON.stringify({
          "syncVersions/employees": 1,
        }),
        muteHttpExceptions: true,
      },
    );
    expect(credentialsProvider).not.toHaveBeenCalled();
  });
  it("propagates HTTP and fetch failures", () => {
    const fetch = vi.fn(() => ({
      getResponseCode: () => 403,
      getContentText: () => "permission denied",
    }));
    const transport = new FirebaseRtdbRestTransport({
      databaseUrl: "https://example.firebaseio.com",
      urlFetchApp: {
        fetch,
      } as unknown as GoogleAppsScript.URL_Fetch.UrlFetchApp,
      credentialsProvider: vi.fn(),
      cacheService: {
        getScriptCache: () => ({ get: () => "token", put: vi.fn() }),
      },
    });
    expect(() => transport.patch({})).toThrow("HTTP 403");
    fetch.mockImplementationOnce(() => {
      throw new Error("network failed");
    });
    expect(() => transport.patch({})).toThrow("network failed");
  });
});
