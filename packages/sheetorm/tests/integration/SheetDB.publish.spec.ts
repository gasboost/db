import { InMemoryCacheService } from "@gasboost/fake-core";
import { NodeUtilities } from "@gasboost/fake-node";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
// Exercise the public, built RTDB package without coupling either production package.
// CI builds realtime-firebase before running SheetORM's integration tests.
import { FirebaseRtdb } from "../../../realtime-firebase/dist";
import {
  InMemoryDataStore,
  InMemoryGateway,
  SheetDB,
  SheetTable,
} from "../../src";

function setup() {
  const employees = new SheetTable({
    dbId: "db",
    name: "employees",
    primaryKey: "id",
    schema: z.object({ id: z.string(), ownerId: z.string() }),
  });
  const tasks = new SheetTable({
    dbId: "db",
    name: "tasks",
    primaryKey: "id",
    schema: z.object({
      id: z.string(),
      employeeId: z.string(),
      title: z.string(),
    }),
  }).reference("employeeId", employees, "id", "cascade");
  const tables = [employees, tasks] as const;
  const cacheService = new InMemoryCacheService();
  const cache = cacheService.getScriptCache();
  vi.spyOn(cacheService, "getScriptCache").mockReturnValue(cache);
  const counters = new Map<string, number>();
  const next = vi.fn((name: string) => {
    expect(cache.get(`db:${name}`)).toBeTruthy();
    const version = (counters.get(name) ?? 0) + 1;
    counters.set(name, version);
    return version;
  });
  const patch = vi.fn((_updates: Readonly<Record<string, unknown>>) => {
    expect(cache.get("db:employees")).toBeTruthy();
    expect(cache.get("db:tasks")).toBeTruthy();
  });
  const rtdb = new FirebaseRtdb({
    versionStore: { next },
    transport: { patch },
  });
  const afterCommit = vi.fn((changes: Parameters<typeof rtdb.publish>[0]) =>
    rtdb.publish(changes),
  );
  const db = new SheetDB({
    tables,
    cacheService,
    utilities: new NodeUtilities(),
    afterCommit,
    gateway: new InMemoryGateway(
      new InMemoryDataStore(
        new Map([
          [
            "db:employees",
            [
              ["id", "ownerId"],
              ["e1", "alice"],
            ],
          ],
          [
            "db:tasks",
            [
              ["id", "employeeId", "title"],
              ["t1", "e1", "unchanged"],
            ],
          ],
        ]),
      ),
    ),
  });
  return { db, afterCommit, patch, next, cache };
}

describe("SheetDB afterCommit → RTDB table version notifications", () => {
  it.each([false, true])(
    "notifies only the changed parent table (transaction=%s)",
    (transaction) => {
      const { db, afterCommit, patch, next, cache } = setup();
      const update = () =>
        db.table("employees").update([{ id: "e1", ownerId: "bob" }]);
      if (transaction) db.transaction(update);
      else update();
      expect(afterCommit).toHaveBeenCalledExactlyOnceWith([
        {
          table: "employees",
          before: { id: "e1", ownerId: "alice" },
          after: { id: "e1", ownerId: "bob" },
        },
      ]);
      expect(patch).toHaveBeenCalledExactlyOnceWith({
        "syncVersions/employees": 1,
      });
      expect(next).toHaveBeenCalledExactlyOnceWith("employees");
      expect(db.table("tasks").find()).toEqual([
        { id: "t1", employeeId: "e1", title: "unchanged" },
      ]);
      expect(cache.get("db:employees")).toBeNull();
      expect(cache.get("db:tasks")).toBeNull();
    },
  );

  it("propagates publish failure while preserving committed data and releasing locks", () => {
    const { db, next, patch, cache } = setup();
    patch.mockImplementationOnce(() => {
      throw new Error("offline");
    });
    expect(() =>
      db.table("employees").update([{ id: "e1", ownerId: "bob" }]),
    ).toThrow("offline");
    expect(db.table("employees").find()).toEqual([
      { id: "e1", ownerId: "bob" },
    ]);
    expect(cache.get("db:employees")).toBeNull();
    expect(cache.get("db:tasks")).toBeNull();
    db.table("employees").update([{ id: "e1", ownerId: "charlie" }]);
    expect(next).toHaveBeenCalledTimes(2);
    expect(patch.mock.calls[1][0]).toEqual({ "syncVersions/employees": 2 });
  });

  it("notifies parent and cascaded child deletion in one PATCH without tombstones", () => {
    const { db, patch, next } = setup();
    db.table("employees").delete(["e1"]);
    expect(patch).toHaveBeenCalledExactlyOnceWith({
      "syncVersions/employees": 1,
      "syncVersions/tasks": 1,
    });
    expect(next.mock.calls).toEqual([["employees"], ["tasks"]]);
    expect(db.table("tasks").find()).toEqual([]);
  });

  it("notifies each changed table once per transaction", () => {
    const { db, patch, next, afterCommit } = setup();
    db.transaction(() => {
      db.table("employees").update([{ id: "e1", ownerId: "bob" }]);
      db.table("tasks").update([
        { id: "t1", employeeId: "e1", title: "edited" },
      ]);
      db.table("tasks").create([
        { id: "t2", employeeId: "e1", title: "created" },
      ]);
    });
    expect(afterCommit).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledExactlyOnceWith({
      "syncVersions/employees": 1,
      "syncVersions/tasks": 1,
    });
    expect(next.mock.calls).toEqual([["employees"], ["tasks"]]);
  });
});
