import { InMemoryCacheService } from "@gasboost/fake-core";
import { NodeUtilities } from "@gasboost/fake-node";
import type { TableChange } from "@gasboost/table";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  SheetDB,
  SheetTable,
  InMemoryGateway,
  InMemoryDataStore,
} from "../../src";
import { CreateCommand } from "../../src/commands/CreateCommand";

function setup(
  onDelete: "cascade" | "set null" = "cascade",
  hook?: (changes: readonly TableChange<any>[]) => void,
) {
  const parents = new SheetTable({
    dbId: "db",
    name: "parents",
    primaryKey: "id",
    schema: z.object({ id: z.number(), name: z.string() }),
  });
  const children = new SheetTable({
    dbId: "db",
    name: "children",
    primaryKey: "id",
    schema: z.object({
      id: z.number(),
      parentId: z.number().nullable(),
      name: z.string(),
    }),
  }).reference("parentId", parents, "id", onDelete);
  const gateway = new InMemoryGateway(
    new InMemoryDataStore(
      new Map([
        [
          "db:parents",
          [
            ["id", "name"],
            [1, "first"],
          ],
        ],
        [
          "db:children",
          [
            ["id", "parentId", "name"],
            [10, 1, "child"],
          ],
        ],
      ]),
    ),
  );
  const cacheService = new InMemoryCacheService();
  const scriptCache = cacheService.getScriptCache();
  vi.spyOn(cacheService, "getScriptCache").mockReturnValue(scriptCache);
  const utilities = new NodeUtilities();
  const afterCommit = vi.fn(hook);
  const db = new SheetDB({
    tables: [parents, children] as const,
    gateway,
    cacheService,
    utilities,
    afterCommit,
  });
  return {
    db,
    parents,
    children,
    gateway,
    cacheService,
    utilities,
    afterCommit,
  };
}

describe("afterCommit", () => {
  it("emits complete independent snapshots for ordinary CRUD", () => {
    const { db, afterCommit } = setup();
    const record = { id: 2, name: "new" };
    const created = db.table("parents").create([record]);
    record.name = "mutated";
    created[0].name = "also mutated";
    expect(afterCommit.mock.calls[0][0]).toEqual([
      { table: "parents", before: null, after: { id: 2, name: "new" } },
    ]);
    db.table("parents").update([{ id: 2, name: "updated" }]);
    expect(afterCommit.mock.calls[1][0]).toEqual([
      {
        table: "parents",
        before: { id: 2, name: "new" },
        after: { id: 2, name: "updated" },
      },
    ]);
    db.table("parents").delete([2]);
    expect(afterCommit.mock.calls[2][0]).toEqual([
      { table: "parents", before: { id: 2, name: "updated" }, after: null },
    ]);
  });

  it("emits one event for mixed upsert", () => {
    const { db, afterCommit } = setup();
    db.table("parents").upsert([
      { id: 1, name: "updated" },
      { id: 2, name: "new" },
    ]);
    expect(afterCommit).toHaveBeenCalledTimes(1);
    expect(afterCommit.mock.calls[0][0]).toEqual([
      {
        table: "parents",
        before: { id: 1, name: "first" },
        after: { id: 1, name: "updated" },
      },
      { table: "parents", before: null, after: { id: 2, name: "new" } },
    ]);
  });

  it("normalizes multiple commands and drops create/delete and unchanged updates", () => {
    const { db, afterCommit } = setup();
    db.transaction(() => {
      db.table("parents").update([{ id: 1, name: "middle" }]);
      db.table("parents").update([{ id: 1, name: "last" }]);
      db.table("parents").create([{ id: 2, name: "temporary" }]);
      db.table("parents").delete([2]);
    });
    expect(afterCommit).toHaveBeenCalledTimes(1);
    expect(afterCommit.mock.calls[0][0]).toEqual([
      {
        table: "parents",
        before: { id: 1, name: "first" },
        after: { id: 1, name: "last" },
      },
    ]);
    afterCommit.mockClear();
    db.table("parents").update([{ id: 1, name: "last" }]);
    db.table("parents").create([]);
    db.table("parents").delete([999]);
    db.transaction(() => {});
    expect(afterCommit).not.toHaveBeenCalled();
  });

  it("aggregates all tables in one transaction notification", () => {
    const { db, afterCommit } = setup();
    db.transaction(() => {
      db.table("parents").update([{ id: 1, name: "last" }]);
      db.table("children").update([
        { id: 10, parentId: 1, name: "last child" },
      ]);
    });
    expect(afterCommit).toHaveBeenCalledTimes(1);
    expect(afterCommit.mock.calls[0][0]).toHaveLength(2);
  });

  it("includes nested creates with no relation payload in the snapshot", () => {
    const { db, afterCommit } = setup();
    db.table("parents").create([
      {
        id: 2,
        name: "parent",
        relations: { children: [{ id: 20, name: "nested" }] },
      },
    ]);
    expect(afterCommit).toHaveBeenCalledTimes(1);
    expect(afterCommit.mock.calls[0][0]).toEqual([
      { table: "parents", before: null, after: { id: 2, name: "parent" } },
      {
        table: "children",
        before: null,
        after: { id: 20, parentId: 2, name: "nested" },
      },
    ]);
  });

  it.each(["cascade", "set null"] as const)("includes %s effects", (action) => {
    const { db, afterCommit } = setup(action);
    db.table("parents").delete([1]);
    expect(afterCommit).toHaveBeenCalledTimes(1);
    expect(afterCommit.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        { table: "parents", before: { id: 1, name: "first" }, after: null },
        {
          table: "children",
          before: { id: 10, parentId: 1, name: "child" },
          after:
            action === "cascade"
              ? null
              : { id: 10, parentId: null, name: "child" },
        },
      ]),
    );
  });

  it("holds sorted related-table locks until hook completion", () => {
    const { db, parents, children, cacheService, afterCommit } = setup();
    const events: string[] = [];
    for (const table of [parents, children]) {
      const lock = table.lock.bind(table);
      vi.spyOn(table, "lock").mockImplementation((...args) => {
        events.push(`lock:${table.name}`);
        lock(...args);
      });
      const release = table.releaseLock.bind(table);
      vi.spyOn(table, "releaseLock").mockImplementation(() => {
        events.push(`release:${table.name}`);
        release();
      });
    }
    afterCommit.mockImplementation(() => {
      expect(cacheService.getScriptCache().get("db:parents")).toBeTruthy();
      expect(cacheService.getScriptCache().get("db:children")).toBeTruthy();
      events.push("hook");
    });
    db.table("parents").delete([1]);
    expect(events.slice(0, 2)).toEqual(["lock:children", "lock:parents"]);
    expect(events.slice(-3)).toEqual([
      "hook",
      "release:parents",
      "release:children",
    ]);
    expect(cacheService.getScriptCache().get("db:parents")).toBeNull();
  });

  it("does not notify when a sheet write fails and rolls back earlier writes", () => {
    const { db, gateway, afterCommit } = setup();
    const update = gateway.update.bind(gateway);
    vi.spyOn(gateway, "update")
      .mockImplementationOnce(update)
      .mockImplementationOnce(() => {
        throw new Error("sheet failed");
      });
    expect(() =>
      db.transaction(() => {
        db.table("children").update([{ id: 10, parentId: 1, name: "changed" }]);
        db.table("parents").update([{ id: 1, name: "changed" }]);
      }),
    ).toThrow("sheet failed");
    expect(afterCommit).not.toHaveBeenCalled();
    expect(db.table("parents").find()).toEqual([{ id: 1, name: "first" }]);
    expect(db.table("children").find()).toEqual([
      { id: 10, parentId: 1, name: "child" },
    ]);
  });

  it("rolls back nested inserts when a later write fails", () => {
    const { db, gateway, afterCommit } = setup();
    const insert = gateway.insert.bind(gateway);
    vi.spyOn(gateway, "insert")
      .mockImplementationOnce(insert)
      .mockImplementationOnce(() => {
        throw new Error("nested failure");
      });
    expect(() =>
      db.transaction(() =>
        db
          .table("parents")
          .create([
            {
              id: 2,
              name: "parent",
              relations: { children: [{ id: 20, name: "nested" }] },
            },
          ]),
      ),
    ).toThrow("nested failure");
    expect(db.table("parents").find()).toEqual([{ id: 1, name: "first" }]);
    expect(afterCommit).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "propagates hook failures without rollback (transaction=%s)",
    (transaction) => {
      const { db, afterCommit, cacheService } = setup();
      afterCommit.mockImplementation(() => {
        throw new Error("publish failed");
      });
      const write = () =>
        db.table("parents").update([{ id: 1, name: "committed" }]);
      expect(() => (transaction ? db.transaction(write) : write())).toThrow(
        "publish failed",
      );
      expect(db.table("parents").find()).toEqual([
        { id: 1, name: "committed" },
      ]);
      expect(cacheService.getScriptCache().get("db:parents")).toBeNull();
      afterCommit.mockReset();
      write();
      expect(afterCommit).not.toHaveBeenCalled();
    },
  );

  it("notifies direct commit once and keeps its rollback backup independent", () => {
    const { db, parents, gateway, cacheService, utilities, afterCommit } =
      setup();
    parents.cache.add(
      new CreateCommand(
        gateway,
        parents,
        cacheService,
        utilities,
        [{ id: 2, name: "queued" }],
        { ensureInsert() {}, ensureUpdate() {}, ensureDelete() {} },
      ),
    );
    db.commit(parents);
    db.commit(parents);
    expect(afterCommit).toHaveBeenCalledTimes(1);
    db.rollback(parents);
    expect(db.table("parents").find()).toEqual([{ id: 1, name: "first" }]);
  });

  it("defers explicit commit notification until the transaction completes", () => {
    const { db, parents, afterCommit } = setup();
    db.transaction(() => {
      db.table("parents").create([{ id: 2, name: "queued" }]);
      db.commit(parents);
      expect(afterCommit).not.toHaveBeenCalled();
      db.table("parents").update([{ id: 2, name: "final" }]);
    });
    expect(afterCommit).toHaveBeenCalledExactlyOnceWith([
      { table: "parents", before: null, after: { id: 2, name: "final" } },
    ]);
  });

  it("skips net-zero transactions, including records with different property order", () => {
    const { db, afterCommit } = setup();
    db.transaction(() => {
      db.table("parents").create([{ id: 2, name: "temporary" }]);
      db.table("parents").delete([2]);
      db.table("parents").update([{ id: 1, name: "temporary" }]);
      db.table("parents").update([{ name: "first", id: 1 }]);
    });
    expect(afterCommit).not.toHaveBeenCalled();
  });

  it("releases already acquired locks when a later acquisition fails", () => {
    const { db, parents, cacheService, afterCommit } = setup();
    vi.spyOn(parents, "lock").mockImplementation(() => {
      throw new Error("lock failed");
    });
    expect(() => db.table("parents").create([{ id: 2, name: "new" }])).toThrow(
      "lock failed",
    );
    expect(cacheService.getScriptCache().get("db:children")).toBeNull();
    expect(afterCommit).not.toHaveBeenCalled();
  });

  it("preserves optimistic locking and snapshots before preview mutates records", () => {
    const table = new SheetTable({
      dbId: "db",
      name: "versioned",
      primaryKey: "id",
      versionColumn: "version",
      schema: z.object({
        id: z.number(),
        version: z.number(),
        name: z.string(),
      }),
    });
    const afterCommit = vi.fn();
    const db = new SheetDB({
      tables: [table],
      gateway: new InMemoryGateway(
        new InMemoryDataStore(
          new Map([
            [
              "db:versioned",
              [
                ["id", "version", "name"],
                [1, 4, "before"],
              ],
            ],
          ]),
        ),
      ),
      cacheService: new InMemoryCacheService(),
      utilities: new NodeUtilities(),
      afterCommit,
    });
    expect(
      db.table("versioned").update([{ id: 1, version: 4, name: "after" }]),
    ).toEqual([{ id: 1, version: 5, name: "after" }]);
    expect(afterCommit).toHaveBeenCalledExactlyOnceWith([
      {
        table: "versioned",
        before: { id: 1, version: 4, name: "before" },
        after: { id: 1, version: 5, name: "after" },
      },
    ]);
    expect(() =>
      db.table("versioned").update([{ id: 1, version: 4, name: "stale" }]),
    ).toThrow("Optimistic lock error");
    expect(afterCommit).toHaveBeenCalledTimes(1);
  });

  it("keeps nested values independent of input and returned records", () => {
    const table = new SheetTable({
      dbId: "db",
      name: "nested",
      primaryKey: "id",
      schema: z.object({
        id: z.number(),
        details: z.object({ names: z.array(z.string()) }),
      }),
    });
    const afterCommit = vi.fn();
    const db = new SheetDB({
      tables: [table],
      gateway: new InMemoryGateway(
        new InMemoryDataStore(new Map([["db:nested", [["id", "details"]]]])),
      ),
      cacheService: new InMemoryCacheService(),
      utilities: new NodeUtilities(),
      afterCommit,
    });
    const input = { id: 1, details: { names: ["before"] } };
    const result = db.table("nested").create([input]);
    input.details.names.push("input mutation");
    result[0].details.names.push("result mutation");
    expect(afterCommit.mock.calls[0][0][0].after.details.names).toEqual([
      "before",
    ]);
  });

  it("does not hook seed/migrate", () => {
    const { db, afterCommit } = setup();
    db.migrate();
    db.seed("parents", []);
    expect(afterCommit).not.toHaveBeenCalled();
  });
});
