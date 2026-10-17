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
import { FirebaseRtdb, type FirebaseRtdbRecordQuery } from "../src";

const employees = defineTable({
  name: "employees",
  primaryKey: "id",
  schema: z.object({ id: z.string(), ownerId: z.string(), name: z.string() }),
});
const tasks = defineTable({
  name: "tasks",
  primaryKey: "id",
  schema: z.object({
    id: z.string(),
    employeeId: z.string(),
    title: z.string(),
  }),
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
const before = { id: "e1", ownerId: "alice", name: "employee" };
const after = { ...before, ownerId: "bob" };
const task = { id: "t1", employeeId: "e1", title: "unchanged task" };
function setup(query?: FirebaseRtdbRecordQuery) {
  const next = vi.fn(() => 7);
  const patch = vi.fn();
  const rtdb = new FirebaseRtdb({
    tables: [employees, tasks],
    principal: { userId: "auth.uid" },
    rowLevelSecurity: [security],
    query,
    versionStore: { next },
    transport: { patch },
  });
  return { rtdb, next, patch };
}

describe("relation partition dependent publication", () => {
  it("automatically moves all unchanged children with one version per table and one PATCH", () => {
    const t2 = { ...task, id: "t2" };
    const query = vi.fn(() => [task, t2]);
    const { rtdb, next, patch } = setup(query);
    const change = Object.freeze({
      table: "employees" as const,
      before: Object.freeze(before),
      after: Object.freeze(after),
    });
    const changes = Object.freeze([change]);
    rtdb.publish(changes);
    expect(query).toHaveBeenCalledExactlyOnceWith({
      table: tasks,
      column: "employeeId",
      value: "e1",
    });
    expect(next.mock.calls).toEqual([["employees"], ["tasks"]]);
    expect(patch).toHaveBeenCalledExactlyOnceWith({
      "employees/e1": { ...after, __syncVersion: 7 },
      "tasks/__rls/ownerId/alice/t1": {
        id: "t1",
        __deleted: true,
        __syncVersion: 7,
      },
      "tasks/__rls/ownerId/alice/t2": {
        id: "t2",
        __deleted: true,
        __syncVersion: 7,
      },
      "tasks/__rls/ownerId/bob/t1": { ...task, __syncVersion: 7 },
      "tasks/__rls/ownerId/bob/t2": { ...t2, __syncVersion: 7 },
      "__gasboost/tableVersions/employees": 7,
      "__gasboost/tableVersions/tasks/__rls/ownerId/alice": 7,
      "__gasboost/tableVersions/tasks/__rls/ownerId/bob": 7,
    });
    expect(changes).toHaveLength(1);
    expect(task).not.toHaveProperty("__syncVersion");
  });

  it("preserves explicit child updates, creates, deletes and reparenting", () => {
    const e2 = { ...before, id: "e2", ownerId: "charlie" };
    const updated = { ...task, title: "updated" };
    const created = { ...task, id: "created" };
    const reparented = { ...task, id: "reparented", employeeId: "e2" };
    const query = vi.fn<FirebaseRtdbRecordQuery>((request) =>
      request.table.name === "employees" ? [e2] : [updated, created],
    );
    const { rtdb, next, patch } = setup(query);
    rtdb.publish([
      { table: "employees", before, after },
      { table: "tasks", before: task, after: updated },
      { table: "tasks", before: null, after: created },
      { table: "tasks", before: { ...task, id: "deleted" }, after: null },
      {
        table: "tasks",
        before: { ...task, id: "reparented" },
        after: reparented,
      },
    ]);
    const updates = patch.mock.calls[0][0];
    expect(updates["tasks/__rls/ownerId/bob/t1"]).toEqual({
      ...updated,
      __syncVersion: 7,
    });
    expect(updates["tasks/__rls/ownerId/bob/created"]).toEqual({
      ...created,
      __syncVersion: 7,
    });
    expect(updates).not.toHaveProperty("tasks/__rls/ownerId/alice/created");
    expect(updates["tasks/__rls/ownerId/alice/deleted"]).toMatchObject({
      __deleted: true,
    });
    expect(updates).not.toHaveProperty("tasks/__rls/ownerId/bob/deleted");
    expect(updates["tasks/__rls/ownerId/charlie/reparented"]).toEqual({
      ...reparented,
      __syncVersion: 7,
    });
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("does not query dependents when only unrelated parent fields change", () => {
    const query = vi.fn(() => [task]);
    const { rtdb, next, patch } = setup(query);
    rtdb.publish([
      { table: "employees", before, after: { ...before, name: "renamed" } },
    ]);
    expect(query).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledExactlyOnceWith("employees");
    expect(Object.keys(patch.mock.calls[0][0])).toEqual([
      "employees/e1",
      "__gasboost/tableVersions/employees",
    ]);
  });

  it("does not allocate a child version for an empty dependent set", () => {
    const { rtdb, next } = setup(() => []);
    rtdb.publish([{ table: "employees", before, after }]);
    expect(next).toHaveBeenCalledExactlyOnceWith("employees");
  });

  it("tombstones surviving dependents when their partition source is deleted", () => {
    const { rtdb, patch } = setup(() => [task]);
    rtdb.publish([{ table: "employees", before, after: null }]);
    expect(patch.mock.calls[0][0]["tasks/__rls/ownerId/alice/t1"]).toEqual({
      id: "t1",
      __deleted: true,
      __syncVersion: 7,
    });
    expect(
      Object.keys(patch.mock.calls[0][0]).some((path) => path.includes("bob")),
    ).toBe(false);
  });

  it("fails before version allocation if dependent enumeration is unavailable", () => {
    const { rtdb, next, patch } = setup();
    expect(() => rtdb.publish([{ table: "employees", before, after }])).toThrow(
      "query resolver",
    );
    expect(next).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it.each([
    () => {
      throw new Error("query failed");
    },
    () => Promise.resolve([task]),
    () => [{ ...task, employeeId: "wrong" }],
  ])(
    "fails closed on failed, asynchronous or mismatched query results",
    (query) => {
      const { rtdb, next, patch } = setup(query as FirebaseRtdbRecordQuery);
      expect(() =>
        rtdb.publish([{ table: "employees", before, after }]),
      ).toThrow();
      expect(next).not.toHaveBeenCalled();
      expect(patch).not.toHaveBeenCalled();
    },
  );

  it("propagates PATCH failures and re-enumerates dependents on retry", () => {
    const query = vi.fn(() => [task]);
    const { rtdb, patch } = setup(query);
    patch.mockImplementationOnce(() => {
      throw new Error("offline");
    });
    const changes: TableChange<typeof employees>[] = [
      { table: "employees", before, after },
    ];
    expect(() => rtdb.publish(changes)).toThrow("offline");
    rtdb.publish(changes);
    expect(query).toHaveBeenCalledTimes(2);
    expect(patch.mock.calls[1][0]).toEqual(patch.mock.calls[0][0]);
  });
});
