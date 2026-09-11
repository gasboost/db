import { InMemoryCacheService } from "@gasboost/fake-core";
import { NodeUtilities } from "@gasboost/fake-node";
import { allow, column, eq, principal, RowLevelSecurity } from "@gasboost/rls";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SheetDB } from "../../src/core/SheetDB";
import { SheetTable } from "../../src/core/SheetTable";
import { InMemoryGateway } from "../../src/gateway/InMemoryGateway";
import { InMemoryDataStore } from "../../src/storage/InMemoryDataStore";

const principalSchema = z.object({
  userId: z.string(),
});

function createContext() {
  const dealSchema = z.object({
    id: z.number().meta({ primary: true }),
    ownerId: z.string(),
    name: z.string(),
    amount: z.number(),
  });

  const dealTable = new SheetTable({
    dbId: "db",
    name: "deals",
    schema: dealSchema,
    primaryKey: "id",
  });

  const store = new InMemoryDataStore(
    new Map([
      [
        "db:deals",
        [
          ["id", "ownerId", "name", "amount"],
          [1, "user-1", "A", 100],
          [2, "user-2", "B", 200],
          [3, "user-1", "C", 300],
          [4, "user-2", "D", 400],
        ],
      ],
    ]),
  );

  const dealSecurity = new RowLevelSecurity({
    table: dealTable,

    select: {
      using: eq(
        column(dealTable, "ownerId"),
        principal(principalSchema, "userId"),
      ),
    },

    insert: {
      check: eq(
        column(dealTable, "ownerId"),
        principal(principalSchema, "userId"),
      ),
    },

    update: {
      using: eq(
        column(dealTable, "ownerId"),
        principal(principalSchema, "userId"),
      ),
      check: eq(
        column(dealTable, "ownerId"),
        principal(principalSchema, "userId"),
      ),
    },

    delete: {
      using: eq(
        column(dealTable, "ownerId"),
        principal(principalSchema, "userId"),
      ),
    },
  });

  const db = new SheetDB({
    tables: [dealTable] as const,
    gateway: new InMemoryGateway(store),
    cacheService: new InMemoryCacheService(),
    utilities: new NodeUtilities(),
    principal: {
      userId: "user-1",
    },
    rowLevelSecurity: [dealSecurity],
  });

  return {
    db,
    store,
    dealTable,
  };
}

describe("SheetDB RLS integration", () => {
  describe("find", () => {
    it("select.usingで許可されたRecordだけ返す", () => {
      const { db } = createContext();

      const records = db.table("deals").find();

      expect(records).toEqual([
        {
          id: 1,
          ownerId: "user-1",
          name: "A",
          amount: 100,
        },
        {
          id: 3,
          ownerId: "user-1",
          name: "C",
          amount: 300,
        },
      ]);
    });

    it("RLS未設定Tableは従来どおり全Recordを返す", () => {
      const schema = z.object({
        id: z.number().meta({ primary: true }),
        name: z.string(),
      });

      const table = new SheetTable({
        dbId: "db",
        name: "masters",
        schema,
        primaryKey: "id",
      });

      const store = new InMemoryDataStore(
        new Map([
          [
            "db:masters",
            [
              ["id", "name"],
              [1, "A"],
              [2, "B"],
            ],
          ],
        ]),
      );

      const db = new SheetDB({
        tables: [table] as const,
        gateway: new InMemoryGateway(store),
        cacheService: new InMemoryCacheService(),
        utilities: new NodeUtilities(),
        principal: {
          userId: "user-1",
        },
      });

      expect(db.table("masters").find()).toEqual([
        {
          id: 1,
          name: "A",
        },
        {
          id: 2,
          name: "B",
        },
      ]);
    });

    it("RLSありでselect policy未定義ならdefault denyする", () => {
      const schema = z.object({
        id: z.number().meta({ primary: true }),
      });

      const table = new SheetTable({
        dbId: "db",
        name: "secrets",
        schema,
        primaryKey: "id",
      });

      const store = new InMemoryDataStore(
        new Map([["db:secrets", [["id"], [1], [2]]]]),
      );

      const db = new SheetDB({
        tables: [table] as const,
        gateway: new InMemoryGateway(store),
        cacheService: new InMemoryCacheService(),
        utilities: new NodeUtilities(),
        principal: {
          userId: "user-1",
        },
        rowLevelSecurity: [
          new RowLevelSecurity({
            table,
          }),
        ],
      });

      expect(db.table("secrets").find()).toEqual([]);
    });

    it("allow()なら全Recordを返す", () => {
      const schema = z.object({
        id: z.number().meta({ primary: true }),
      });

      const table = new SheetTable({
        dbId: "db",
        name: "publics",
        schema,
        primaryKey: "id",
      });

      const store = new InMemoryDataStore(
        new Map([["db:publics", [["id"], [1], [2]]]]),
      );

      const db = new SheetDB({
        tables: [table] as const,
        gateway: new InMemoryGateway(store),
        cacheService: new InMemoryCacheService(),
        utilities: new NodeUtilities(),
        principal: {
          userId: "user-1",
        },
        rowLevelSecurity: [
          new RowLevelSecurity({
            table,
            select: {
              using: allow(),
            },
          }),
        ],
      });

      expect(db.table("publics").find()).toEqual([{ id: 1 }, { id: 2 }]);
    });
  });

  describe("query", () => {
    it("RLSをQueryより先に適用する", () => {
      const { db } = createContext();

      const query = db.query("deals").orderBy("amount", "desc").limit(1);

      const records = db.find(query);

      expect(records).toEqual([
        {
          id: 3,
          ownerId: "user-1",
          name: "C",
          amount: 300,
        },
      ]);
    });

    it("offsetもRLS適用後のRecordに対して評価する", () => {
      const { db } = createContext();

      const query = db
        .query("deals")
        .orderBy("amount", "asc")
        .offset(1)
        .limit(1);

      const records = db.find(query);

      expect(records).toEqual([
        {
          id: 3,
          ownerId: "user-1",
          name: "C",
          amount: 300,
        },
      ]);
    });
  });

  describe("create", () => {
    it("insert.checkを満たすRecordを作成できる", () => {
      const { db, store } = createContext();

      db.table("deals").create([
        {
          id: 5,
          ownerId: "user-1",
          name: "E",
          amount: 500,
        },
      ]);

      expect(store.dump()).toEqual([
        ["id", "ownerId", "name", "amount"],
        [1, "user-1", "A", 100],
        [2, "user-2", "B", 200],
        [3, "user-1", "C", 300],
        [4, "user-2", "D", 400],
        [5, "user-1", "E", 500],
      ]);
    });

    it("insert.checkを満たさないRecordはwrite前に拒否する", () => {
      const { db, store } = createContext();

      expect(() =>
        db.table("deals").create([
          {
            id: 5,
            ownerId: "user-2",
            name: "E",
            amount: 500,
          },
        ]),
      ).toThrow("RLS denied insert");

      expect(store.dump()).toEqual([
        ["id", "ownerId", "name", "amount"],
        [1, "user-1", "A", 100],
        [2, "user-2", "B", 200],
        [3, "user-1", "C", 300],
        [4, "user-2", "D", 400],
      ]);
    });
  });

  describe("update", () => {
    it("update.usingとupdate.checkを満たすRecordを更新できる", () => {
      const { db, store } = createContext();

      db.table("deals").update([
        {
          id: 1,
          ownerId: "user-1",
          name: "updated",
          amount: 150,
        },
      ]);

      expect(store.dump()).toEqual([
        ["id", "ownerId", "name", "amount"],
        [1, "user-1", "updated", 150],
        [2, "user-2", "B", 200],
        [3, "user-1", "C", 300],
        [4, "user-2", "D", 400],
      ]);
    });

    it("update.usingを満たさない既存Recordの更新を拒否する", () => {
      const { db, store } = createContext();

      expect(() =>
        db.table("deals").update([
          {
            id: 2,
            ownerId: "user-2",
            name: "updated",
            amount: 250,
          },
        ]),
      ).toThrow("RLS denied update");

      expect(store.dump()).toEqual([
        ["id", "ownerId", "name", "amount"],
        [1, "user-1", "A", 100],
        [2, "user-2", "B", 200],
        [3, "user-1", "C", 300],
        [4, "user-2", "D", 400],
      ]);
    });

    it("update.checkによりownerIdの付け替えを拒否する", () => {
      const { db, store } = createContext();

      expect(() =>
        db.table("deals").update([
          {
            id: 1,
            ownerId: "user-2",
            name: "A",
            amount: 100,
          },
        ]),
      ).toThrow("RLS denied updated record");

      expect(store.dump()).toEqual([
        ["id", "ownerId", "name", "amount"],
        [1, "user-1", "A", 100],
        [2, "user-2", "B", 200],
        [3, "user-1", "C", 300],
        [4, "user-2", "D", 400],
      ]);
    });
  });

  describe("upsert", () => {
    it("既存Recordにはupdate policyを適用する", () => {
      const { db, store } = createContext();

      db.table("deals").upsert([
        {
          id: 1,
          ownerId: "user-1",
          name: "updated",
          amount: 150,
        },
      ]);

      expect(store.dump()).toEqual([
        ["id", "ownerId", "name", "amount"],
        [1, "user-1", "updated", 150],
        [2, "user-2", "B", 200],
        [3, "user-1", "C", 300],
        [4, "user-2", "D", 400],
      ]);
    });

    it("新規Recordにはinsert policyを適用する", () => {
      const { db, store } = createContext();

      db.table("deals").upsert([
        {
          id: 5,
          ownerId: "user-1",
          name: "E",
          amount: 500,
        },
      ]);

      expect(store.dump()).toEqual([
        ["id", "ownerId", "name", "amount"],
        [1, "user-1", "A", 100],
        [2, "user-2", "B", 200],
        [3, "user-1", "C", 300],
        [4, "user-2", "D", 400],
        [5, "user-1", "E", 500],
      ]);
    });

    it("mixed batchで1件でも拒否されたらwriteしない", () => {
      const { db, store } = createContext();

      expect(() =>
        db.table("deals").upsert([
          {
            id: 1,
            ownerId: "user-1",
            name: "updated",
            amount: 150,
          },
          {
            id: 5,
            ownerId: "user-2",
            name: "unauthorized",
            amount: 500,
          },
        ]),
      ).toThrow("RLS denied");

      expect(store.dump()).toEqual([
        ["id", "ownerId", "name", "amount"],
        [1, "user-1", "A", 100],
        [2, "user-2", "B", 200],
        [3, "user-1", "C", 300],
        [4, "user-2", "D", 400],
      ]);
    });
  });

  describe("delete", () => {
    it("delete.usingを満たすRecordを削除できる", () => {
      const { db, store } = createContext();

      db.table("deals").delete([1]);

      expect(store.dump()).toEqual([
        ["id", "ownerId", "name", "amount"],
        [2, "user-2", "B", 200],
        [3, "user-1", "C", 300],
        [4, "user-2", "D", 400],
      ]);
    });

    it("delete.usingを満たさないRecordの削除を拒否する", () => {
      const { db, store } = createContext();

      expect(() => db.table("deals").delete([2])).toThrow("RLS denied delete");

      expect(store.dump()).toEqual([
        ["id", "ownerId", "name", "amount"],
        [1, "user-1", "A", 100],
        [2, "user-2", "B", 200],
        [3, "user-1", "C", 300],
        [4, "user-2", "D", 400],
      ]);
    });
  });

  describe("transaction", () => {
    it("transaction内のwriteでもRLSを強制する", () => {
      const { db, store } = createContext();

      expect(() =>
        db.transaction(() => {
          db.table("deals").update([
            {
              id: 1,
              ownerId: "user-2",
              name: "unauthorized",
              amount: 999,
            },
          ]);
        }),
      ).toThrow("RLS denied updated record");

      expect(store.dump()).toEqual([
        ["id", "ownerId", "name", "amount"],
        [1, "user-1", "A", 100],
        [2, "user-2", "B", 200],
        [3, "user-1", "C", 300],
        [4, "user-2", "D", 400],
      ]);
    });
  });

  describe("relation write authorization", () => {
    it("relation child createにもinsert policyを適用する", () => {
      const parentSchema = z.object({
        id: z.number().meta({ primary: true }),
        name: z.string(),
      });

      const childSchema = z.object({
        id: z.number().meta({ primary: true }),
        parentId: z.number(),
        ownerId: z.string(),
        name: z.string(),
      });

      const parentTable = new SheetTable({
        dbId: "db",
        name: "parents",
        schema: parentSchema,
        primaryKey: "id",
      });

      const childTable = new SheetTable({
        dbId: "db",
        name: "children",
        schema: childSchema,
        primaryKey: "id",
      });

      childTable.reference("parentId", parentTable, "id", "cascade");

      const store = new InMemoryDataStore(
        new Map([
          ["db:parents", [["id", "name"]]],
          ["db:children", [["id", "parentId", "ownerId", "name"]]],
        ]),
      );

      const db = new SheetDB({
        tables: [parentTable, childTable] as const,
        gateway: new InMemoryGateway(store),
        cacheService: new InMemoryCacheService(),
        utilities: new NodeUtilities(),
        principal: {
          userId: "user-1",
        },
        rowLevelSecurity: [
          new RowLevelSecurity({
            table: parentTable,
            insert: {
              check: allow(),
            },
          }),
          new RowLevelSecurity({
            table: childTable,
            insert: {
              check: eq(
                column(childTable, "ownerId"),
                principal(principalSchema, "userId"),
              ),
            },
          }),
        ],
      });

      expect(() =>
        db.table("parents").create([
          {
            id: 1,
            name: "parent",
            relations: {
              children: [
                {
                  id: 10,
                  ownerId: "user-2",
                  name: "unauthorized-child",
                },
              ],
            },
          },
        ]),
      ).toThrow("RLS denied insert");

      expect(store.get("db:parents").rows).toEqual([]);

      expect(store.get("db:children").rows).toEqual([]);
    });

    it("cascade delete先のchildにもdelete policyを適用する", () => {
      const parentSchema = z.object({
        id: z.number().meta({ primary: true }),
      });

      const childSchema = z.object({
        id: z.number().meta({ primary: true }),
        parentId: z.number(),
        ownerId: z.string(),
      });

      const parentTable = new SheetTable({
        dbId: "db",
        name: "parents",
        schema: parentSchema,
        primaryKey: "id",
      });

      const childTable = new SheetTable({
        dbId: "db",
        name: "children",
        schema: childSchema,
        primaryKey: "id",
      });

      childTable.reference("parentId", parentTable, "id", "cascade");

      const store = new InMemoryDataStore(
        new Map([
          ["db:parents", [["id"], [1]]],
          [
            "db:children",
            [
              ["id", "parentId", "ownerId"],
              [10, 1, "user-2"],
            ],
          ],
        ]),
      );

      const db = new SheetDB({
        tables: [parentTable, childTable] as const,
        gateway: new InMemoryGateway(store),
        cacheService: new InMemoryCacheService(),
        utilities: new NodeUtilities(),
        principal: {
          userId: "user-1",
        },
        rowLevelSecurity: [
          new RowLevelSecurity({
            table: parentTable,
            delete: {
              using: allow(),
            },
          }),
          new RowLevelSecurity({
            table: childTable,
            delete: {
              using: eq(
                column(childTable, "ownerId"),
                principal(principalSchema, "userId"),
              ),
            },
          }),
        ],
      });

      expect(() => db.table("parents").delete([1])).toThrow(
        "RLS denied delete",
      );

      expect(store.get("db:parents").rows).toEqual([[1]]);

      expect(store.get("db:children").rows).toEqual([[10, 1, "user-2"]]);
    });

    it("set null先のchildにもupdate using/checkを適用する", () => {
      const parentSchema = z.object({
        id: z.number().meta({ primary: true }),
      });

      const childSchema = z.object({
        id: z.number().meta({ primary: true }),
        parentId: z.number().nullable(),
        ownerId: z.string(),
      });

      const parentTable = new SheetTable({
        dbId: "db",
        name: "parents",
        schema: parentSchema,
        primaryKey: "id",
      });

      const childTable = new SheetTable({
        dbId: "db",
        name: "children",
        schema: childSchema,
        primaryKey: "id",
      });

      childTable.reference("parentId", parentTable, "id", "set null");

      const store = new InMemoryDataStore(
        new Map([
          ["db:parents", [["id"], [1]]],
          [
            "db:children",
            [
              ["id", "parentId", "ownerId"],
              [10, 1, "user-2"],
            ],
          ],
        ]),
      );

      const db = new SheetDB({
        tables: [parentTable, childTable] as const,
        gateway: new InMemoryGateway(store),
        cacheService: new InMemoryCacheService(),
        utilities: new NodeUtilities(),
        principal: {
          userId: "user-1",
        },
        rowLevelSecurity: [
          new RowLevelSecurity({
            table: parentTable,
            delete: {
              using: allow(),
            },
          }),
          new RowLevelSecurity({
            table: childTable,
            update: {
              using: eq(
                column(childTable, "ownerId"),
                principal(principalSchema, "userId"),
              ),
              check: eq(
                column(childTable, "ownerId"),
                principal(principalSchema, "userId"),
              ),
            },
          }),
        ],
      });

      expect(() => db.table("parents").delete([1])).toThrow(
        "RLS denied update",
      );

      expect(store.get("db:parents").rows).toEqual([[1]]);

      expect(store.get("db:children").rows).toEqual([[10, 1, "user-2"]]);
    });
  });
});
