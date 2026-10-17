import { InMemoryCacheService } from "@gasboost/fake-core";
import { NodeUtilities } from "@gasboost/fake-node";
import {
  and,
  column,
  eq,
  exists,
  outerColumn,
  principal,
  RowLevelSecurity,
} from "@gasboost/rls";
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
  let db: SheetDB<typeof tables>;
  const rtdb = new FirebaseRtdb({
    tables,
    rowLevelSecurity: [security],
    principal: { userId: "auth.uid" },
    versionStore: { next },
    transport: { patch },
    query: ({ table, column, value }) =>
      db.loadRaw(table.name).filter((record) => record[column] === value),
  });
  const afterCommit = vi.fn((changes: Parameters<typeof rtdb.publish>[0]) =>
    rtdb.publish(changes),
  );
  db = new SheetDB({
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

describe("SheetDB afterCommit → RTDB relation partition publication", () => {
  it.each([false, true])(
    "moves unchanged children after ordinary parent CRUD (transaction=%s)",
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
        "employees/e1": { id: "e1", ownerId: "bob", __syncVersion: 1 },
        "tasks/__rls/ownerId/alice/t1": {
          id: "t1",
          __deleted: true,
          __syncVersion: 1,
        },
        "tasks/__rls/ownerId/bob/t1": {
          id: "t1",
          employeeId: "e1",
          title: "unchanged",
          __syncVersion: 1,
        },
        "__gasboost/tableVersions/employees": 1,
        "__gasboost/tableVersions/tasks/__rls/ownerId/alice": 1,
        "__gasboost/tableVersions/tasks/__rls/ownerId/bob": 1,
      });
      expect(next.mock.calls).toEqual([["employees"], ["tasks"]]);
      expect(db.table("tasks").find()).toEqual([
        { id: "t1", employeeId: "e1", title: "unchanged" },
      ]);
      expect(cache.get("db:employees")).toBeNull();
      expect(cache.get("db:tasks")).toBeNull();
    },
  );

  it("does not duplicate cascaded child deletes when the relation source is deleted", () => {
    const { db, patch, next } = setup();
    db.table("employees").delete(["e1"]);
    expect(patch).toHaveBeenCalledExactlyOnceWith({
      "employees/e1": { id: "e1", __deleted: true, __syncVersion: 1 },
      "tasks/__rls/ownerId/alice/t1": {
        id: "t1",
        __deleted: true,
        __syncVersion: 1,
      },
      "__gasboost/tableVersions/employees": 1,
      "__gasboost/tableVersions/tasks/__rls/ownerId/alice": 1,
    });
    expect(next).toHaveBeenCalledTimes(2);
    expect(db.table("tasks").find()).toEqual([]);
  });

  it("keeps actual child updates when parent and child change in the same transaction", () => {
    const { db, patch, next } = setup();
    db.transaction(() => {
      db.table("employees").update([{ id: "e1", ownerId: "bob" }]);
      db.table("tasks").update([
        { id: "t1", employeeId: "e1", title: "edited" },
      ]);
    });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0][0]["tasks/__rls/ownerId/bob/t1"]).toEqual({
      id: "t1",
      employeeId: "e1",
      title: "edited",
      __syncVersion: 1,
    });
    expect(next.mock.calls).toEqual([["employees"], ["tasks"]]);
  });
});
