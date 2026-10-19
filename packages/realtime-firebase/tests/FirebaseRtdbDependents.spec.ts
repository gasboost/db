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

describe("table version notifications with relation policies", () => {
  it("does not query or publish unchanged dependent tables", () => {
    const query = vi.fn(() => [task]);
    const { rtdb, next, patch } = setup(query);
    const changes = Object.freeze([
      Object.freeze({
        table: "employees" as const,
        before: Object.freeze(before),
        after: Object.freeze(after),
      }),
    ]);
    rtdb.publish(changes);
    expect(query).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledExactlyOnceWith("employees");
    expect(patch).toHaveBeenCalledExactlyOnceWith({
      "syncVersions/employees": 7,
    });
    expect(changes).toHaveLength(1);
    expect(changes[0].after).toEqual(after);
  });

  it("notifies explicit child changes once without resolving record partitions", () => {
    const query = vi.fn(() => {
      throw new Error("query must not run");
    });
    const { rtdb, next, patch } = setup(query);
    rtdb.publish([
      { table: "employees", before, after },
      { table: "tasks", before: task, after: { ...task, title: "updated" } },
      { table: "tasks", before: null, after: { ...task, id: "created" } },
      { table: "tasks", before: { ...task, id: "deleted" }, after: null },
      { table: "tasks", before: task, after: { ...task, employeeId: "e2" } },
    ]);
    expect(query).not.toHaveBeenCalled();
    expect(next.mock.calls).toEqual([["employees"], ["tasks"]]);
    expect(patch).toHaveBeenCalledExactlyOnceWith({
      "syncVersions/employees": 7,
      "syncVersions/tasks": 7,
    });
  });

  it("publishes parent deletion without a dependent query resolver", () => {
    const { rtdb, next, patch } = setup();
    rtdb.publish([{ table: "employees", before, after: null }]);
    expect(next).toHaveBeenCalledExactlyOnceWith("employees");
    expect(patch).toHaveBeenCalledExactlyOnceWith({
      "syncVersions/employees": 7,
    });
  });

  it("propagates PATCH failures and never enumerates dependents on retry", () => {
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
    expect(query).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledTimes(2);
    expect(patch.mock.calls[1][0]).toEqual({ "syncVersions/employees": 7 });
  });
});
