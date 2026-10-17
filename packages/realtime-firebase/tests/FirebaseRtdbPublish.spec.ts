import {
  and,
  column,
  eq,
  exists,
  outerColumn,
  principal,
  RowLevelSecurity,
} from "@gasboost/rls";
import { defineTable, type TableChange } from "@gasboost/table";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  FirebaseRtdb,
  FirebaseRtdbRestTransport,
  PropertiesVersionStore,
  type VersionStore,
} from "../src";

const employees = defineTable({
  name: "employees",
  primaryKey: "id",
  schema: z.object({ id: z.string(), name: z.string(), ownerId: z.string() }),
});
const departments = defineTable({
  name: "departments",
  primaryKey: "id",
  schema: z.object({ id: z.string(), title: z.string() }),
});
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
function setup(secured = false) {
  const versionStore = versions();
  const transport = { patch: vi.fn() };
  const security = new RowLevelSecurity({
    table: employees,
    select: {
      using: eq(
        column(employees, "ownerId"),
        principal(z.object({ userId: z.string() }), "userId"),
      ),
    },
  });
  const rtdb = new FirebaseRtdb({
    tables: [employees, departments],
    principal: { userId: "auth.uid" },
    rowLevelSecurity: secured ? [security] : [],
    versionStore,
    transport,
  });
  return { rtdb, transport, versionStore };
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
  it("publishes create/update/delete plus table versions in one root PATCH", () => {
    const { rtdb, transport, versionStore } = setup();
    rtdb.publish([
      { table: "employees", before, after },
      { table: "employees", before: null, after: { ...before, id: "e2" } },
      { table: "employees", before: { ...before, id: "e3" }, after: null },
      {
        table: "departments",
        before: null,
        after: { id: "d1", title: "department" },
      },
    ]);
    expect(versionStore.next.mock.calls).toEqual([
      ["employees"],
      ["departments"],
    ]);
    expect(transport.patch).toHaveBeenCalledExactlyOnceWith({
      "employees/e1": { ...after, __syncVersion: 1 },
      "employees/e2": { ...before, id: "e2", __syncVersion: 1 },
      "employees/e3": { id: "e3", __deleted: true, __syncVersion: 1 },
      "departments/d1": { id: "d1", title: "department", __syncVersion: 1 },
      "__gasboost/tableVersions/employees": 1,
      "__gasboost/tableVersions/departments": 1,
    });
    rtdb.publish([{ table: "employees", before: after, after: before }]);
    expect(transport.patch.mock.calls[1][0]["employees/e1"]).toMatchObject({
      __syncVersion: 2,
    });
  });
  it("does nothing for an empty commit (even without transport configuration)", () => {
    const { rtdb, transport, versionStore } = setup();
    rtdb.publish([]);
    expect(transport.patch).not.toHaveBeenCalled();
    expect(versionStore.next).not.toHaveBeenCalled();
    new FirebaseRtdb({ tables: [employees], principal: {} }).publish([]);
  });
  it("requires publish dependencies and validates paths before allocating", () => {
    expect(() =>
      new FirebaseRtdb({ tables: [employees], principal: {} }).publish([
        { table: "employees", before: null, after },
      ]),
    ).toThrow("versionStore and transport");
    const { rtdb, transport, versionStore } = setup();
    expect(() =>
      rtdb.publish([
        {
          table: "employees",
          before: null,
          after: { ...after, id: "invalid/path" },
        },
      ]),
    ).toThrow("forbidden character");
    expect(versionStore.next).not.toHaveBeenCalled();
    expect(transport.patch).not.toHaveBeenCalled();
  });
  it("does not mutate changes or overload domain version columns", () => {
    const { rtdb } = setup();
    const change = Object.freeze({
      table: "employees" as const,
      before: Object.freeze(before),
      after: Object.freeze(after),
    });
    rtdb.publish([change]);
    expect(change.after).toEqual(after);
    expect(change.after).not.toHaveProperty("__syncVersion");
  });
  it("leaves a minimal tombstone in the old RLS partition and updates both scope versions", () => {
    const { rtdb, transport } = setup(true);
    rtdb.publish([
      { table: "employees", before, after: { ...after, ownerId: "bob" } },
    ]);
    expect(transport.patch).toHaveBeenCalledExactlyOnceWith({
      "employees/__rls/ownerId/alice/e1": {
        id: "e1",
        __deleted: true,
        __syncVersion: 1,
      },
      "employees/__rls/ownerId/bob/e1": {
        ...after,
        ownerId: "bob",
        __syncVersion: 1,
      },
      "__gasboost/tableVersions/employees/__rls/ownerId/alice": 1,
      "__gasboost/tableVersions/employees/__rls/ownerId/bob": 1,
    });
    expect(rtdb.table("employees").versionPath({ userId: "alice" })).toBe(
      "/__gasboost/tableVersions/employees/__rls/ownerId/alice",
    );
  });
  it("indexes the record scope and restricts version metadata to the same RLS principal", () => {
    const { rtdb } = setup(true);
    const rules = rtdb.rules().rules as any;
    const scope = rules.employees.__rls.ownerId.$scope0;
    const metadata =
      rules.__gasboost.tableVersions.employees.__rls.ownerId.$scope0;
    expect(scope[".indexOn"]).toBe("__syncVersion");
    expect(scope[".read"]).toBe(
      "auth != null && ($scope0 === (auth.uid + ''))",
    );
    expect(metadata[".read"]).toBe(scope[".read"]);
    expect(rules.employees[".read"]).toBeUndefined();
    expect(rules.__gasboost.tableVersions[".read"]).toBeUndefined();
    expect(rules.__gasboost.tableVersions[".write"]).toBe(false);
    // Scope reads are inherited by the tombstones; no domain RLS attributes are required.
  });
  it("denies metadata reads for a table without select permission", () => {
    const rtdb = new FirebaseRtdb({
      tables: [employees],
      principal: {},
      rowLevelSecurity: [new RowLevelSecurity({ table: employees })],
    });
    expect(
      (rtdb.rules().rules.__gasboost as any).tableVersions.employees[".read"],
    ).toBe(false);
  });
  it("propagates PATCH failure, permits a version gap and retries the actual changes", () => {
    const { rtdb, transport } = setup();
    const changes: TableChange<typeof employees>[] = [
      { table: "employees", before, after },
    ];
    transport.patch.mockImplementationOnce(() => {
      throw new Error("offline");
    });
    expect(() => rtdb.publish(changes)).toThrow("offline");
    rtdb.publish(changes);
    expect(transport.patch.mock.calls[1][0]["employees/e1"]).toEqual({
      ...after,
      __syncVersion: 2,
    });
  });
  it("propagates version persistence failure without sending PATCH", () => {
    const transport = { patch: vi.fn() };
    const versionStore: VersionStore = {
      next: () => {
        throw new Error("properties failed");
      },
    };
    const rtdb = new FirebaseRtdb({
      tables: [employees],
      principal: {},
      transport,
      versionStore,
    });
    expect(() => rtdb.publish([{ table: "employees", before, after }])).toThrow(
      "properties failed",
    );
    expect(transport.patch).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "resolves relation partitions with before/after snapshots (explicitChild=%s)",
    (explicitChild) => {
      const tasks = defineTable({
        name: "tasks",
        primaryKey: "id",
        schema: z.object({ id: z.string(), employeeId: z.string() }),
      });
      const security = new RowLevelSecurity({
        table: tasks,
        select: {
          using: exists(
            employees,
            and(
              eq(column(employees, "id"), outerColumn(tasks, "employeeId")),
              eq(
                column(employees, "ownerId"),
                principal(z.object({ userId: z.string() }), "userId"),
              ),
            ),
          ),
        },
      });
      const child = { id: "t1", employeeId: "e1" };
      const query = vi.fn(() => (explicitChild ? [] : [child]));
      const versionStore = versions();
      const transport = { patch: vi.fn() };
      const rtdb = new FirebaseRtdb({
        tables: [employees, tasks],
        principal: { userId: "auth.uid" },
        rowLevelSecurity: [security],
        transport,
        versionStore,
        query,
      });
      const changes: TableChange<typeof employees | typeof tasks>[] = [
        { table: "employees", before, after: { ...after, ownerId: "bob" } },
      ];
      if (explicitChild)
        changes.push({ table: "tasks", before: child, after: child });
      // In the parent-only case the caller supplies no child change at all.
      rtdb.publish(changes);
      expect(changes).toHaveLength(explicitChild ? 2 : 1);
      expect(query).toHaveBeenCalledExactlyOnceWith({
        table: tasks,
        column: "employeeId",
        value: "e1",
      });
      expect(versionStore.next.mock.calls).toEqual([["employees"], ["tasks"]]);
      expect(transport.patch).toHaveBeenCalledExactlyOnceWith({
        "employees/e1": { ...after, ownerId: "bob", __syncVersion: 1 },
        "tasks/__rls/ownerId/alice/t1": {
          id: "t1",
          __deleted: true,
          __syncVersion: 1,
        },
        "tasks/__rls/ownerId/bob/t1": {
          id: "t1",
          employeeId: "e1",
          __syncVersion: 1,
        },
        "__gasboost/tableVersions/employees": 1,
        "__gasboost/tableVersions/tasks/__rls/ownerId/alice": 1,
        "__gasboost/tableVersions/tasks/__rls/ownerId/bob": 1,
      });
    },
  );
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
      "employees/e1": after,
      "__gasboost/tableVersions/employees": 1,
    });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "https://example.firebaseio.com/.json",
      {
        method: "patch",
        contentType: "application/json",
        headers: { Authorization: "Bearer token" },
        payload: JSON.stringify({
          "employees/e1": after,
          "__gasboost/tableVersions/employees": 1,
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
