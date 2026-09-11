import { InMemoryCacheService } from "@gasboost/fake-core";
import { NodeUtilities } from "@gasboost/fake-node";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DeleteCommand } from "../../src/commands/DeleteCommand";
import { SheetDB } from "../../src/core/SheetDB";
import { SheetTable } from "../../src/core/SheetTable";
import { InMemoryGateway } from "../../src/gateway/InMemoryGateway";
import { InMemoryDataStore } from "../../src/storage/InMemoryDataStore";

describe("SheetDB", () => {
  it("skips deleteCascade when no relations", () => {
    const schema = z.object({ id: z.number().meta({ primary: true }) });
    const table = new SheetTable({
      dbId: "db",
      name: "users",
      schema,
      primaryKey: "id",
    });

    const store = new InMemoryDataStore(
      new Map([["db:users", [["id"], [1], [2]]]]),
    );
    const db = new SheetDB({
      tables: [table] as const,
      gateway: new InMemoryGateway(store),
      cacheService: new InMemoryCacheService(),
      utilities: new NodeUtilities(),
    });

    db.table("users");
    expect(() => db.delete([1])).not.toThrow();
  });

  it("locks and sorts multiple cascade tables", () => {
    const userSchema = z.object({ id: z.number().meta({ primary: true }) });
    const postSchema = z.object({
      id: z.number().meta({ primary: true }),
      userId: z.number(),
    });
    const profileSchema = z.object({
      id: z.number().meta({ primary: true }),
      userId: z.number(),
    });

    const userTable = new SheetTable({
      dbId: "db",
      name: "users",
      schema: userSchema,
      primaryKey: "id",
    });
    const postTable = new SheetTable({
      dbId: "db",
      name: "posts",
      schema: postSchema,
      primaryKey: "id",
    });
    const profileTable = new SheetTable({
      dbId: "db",
      name: "profiles",
      schema: profileSchema,
      primaryKey: "id",
    });

    postTable.reference("userId", userTable, "id", "cascade");
    profileTable.reference("userId", userTable, "id", "cascade");

    const store = new InMemoryDataStore(
      new Map([
        ["db:users", [["id"], [1]]],
        [
          "db:posts",
          [
            ["id", "userId"],
            [10, 1],
          ],
        ],
        [
          "db:profiles",
          [
            ["id", "userId"],
            [20, 1],
          ],
        ],
      ]),
    );
    const db = new SheetDB({
      tables: [userTable, postTable, profileTable] as const,
      gateway: new InMemoryGateway(store),
      cacheService: new InMemoryCacheService(),
      utilities: new NodeUtilities(),
    });

    db.table("users");
    expect(() => db.delete([1])).not.toThrow();
  });

  it("handles duplicate cascade relations", () => {
    const userSchema = z.object({ id: z.number().meta({ primary: true }) });
    const childSchema = z.object({
      id: z.number().meta({ primary: true }),
      userId: z.number(),
    });

    const userTable = new SheetTable({
      dbId: "db",
      name: "users",
      schema: userSchema,
      primaryKey: "id",
    });
    const childTable = new SheetTable({
      dbId: "db",
      name: "children",
      schema: childSchema,
      primaryKey: "id",
    });

    childTable.reference("userId", userTable, "id", "cascade");
    childTable.reference("userId", userTable, "id", "cascade");

    const store = new InMemoryDataStore(
      new Map([
        ["db:users", [["id"], [1]]],
        [
          "db:children",
          [
            ["id", "userId"],
            [10, 1],
          ],
        ],
      ]),
    );
    const db = new SheetDB({
      tables: [userTable, childTable] as const,
      gateway: new InMemoryGateway(store),
      cacheService: new InMemoryCacheService(),
      utilities: new NodeUtilities(),
    });

    db.table("users");
    expect(() => db.delete([1])).not.toThrow();
  });

  it("commits delete diff during transaction", async () => {
    const schema = z.object({ id: z.number().meta({ primary: true }) });
    const table = new SheetTable({
      dbId: "db",
      name: "users",
      schema,
      primaryKey: "id",
    });

    const store = new InMemoryDataStore(
      new Map([["db:users", [["id"], [1], [2]]]]),
    );
    const db = new SheetDB({
      tables: [table] as const,
      gateway: new InMemoryGateway(store),
      cacheService: new InMemoryCacheService(),
      utilities: new NodeUtilities(),
    });

    db.transaction(() => {
      db.table("users");
      db.delete([1]);
    });

    db.table("users");
    const records = await db.find();
    expect(records.length).toBe(1);
  });

  it("commits delete diff when called directly", async () => {
    const schema = z.object({ id: z.number().meta({ primary: true }) });
    const table = new SheetTable({
      dbId: "db",
      name: "users",
      schema,
      primaryKey: "id",
    });

    const store = new InMemoryDataStore(
      new Map([["db:users", [["id"], [1], [2]]]]),
    );
    const db = new SheetDB({
      tables: [table] as const,
      gateway: new InMemoryGateway(store),
      cacheService: new InMemoryCacheService(),
      utilities: new NodeUtilities(),
    });

    db.table("users");
    table.cache.add(
      new DeleteCommand(
        table,
        new InMemoryGateway(store),
        new InMemoryCacheService(),
        new NodeUtilities(),
        [1],
      ),
    );
    expect(() => db.commit(table)).not.toThrow();

    db.table("users");
    const records = await db.find();
    expect(records.map((row) => row[table.primaryKey])).toEqual([2]);
  });

  it("updates one row without removing the others", () => {
    const schema = z.object({
      id: z.number().meta({ primary: true }),
      name: z.string(),
    });
    const table = new SheetTable({
      dbId: "db",
      name: "users",
      schema,
      primaryKey: "id",
    });

    const store = new InMemoryDataStore(
      new Map([
        [
          "db:users",
          [
            ["id", "name", "version"],
            [1, "taro", 1],
            [2, "hanako", 1],
          ],
        ],
      ]),
    );
    const db = new SheetDB({
      tables: [table] as const,
      gateway: new InMemoryGateway(store),
      cacheService: new InMemoryCacheService(),
      utilities: new NodeUtilities(),
    });

    expect(store.dump()).toEqual([
      ["id", "name", "version"],
      [1, "taro", 1],
      [2, "hanako", 1],
    ]);

    db.table("users");
    const taro = {
      id: 1,
      name: "taro",
      version: 1,
    };
    taro.name = "yamada";

    db.update([taro]);

    expect(store.dump()).toEqual([
      ["id", "name", "version"],
      [1, "yamada", 1],
      [2, "hanako", 1],
    ]);
  });

  it("returns updated entities with incremented version for optimistic lock tables", () => {
    const schema = z.object({
      id: z.number().meta({ primary: true }),
      name: z.string(),
      version: z.number(),
    });
    const table = new SheetTable({
      dbId: "db",
      name: "users",
      schema,
      primaryKey: "id",
      versionColumn: "version",
    });

    const store = new InMemoryDataStore(
      new Map([
        [
          "db:users",
          [
            ["id", "name", "version"],
            [1, "taro", 1],
          ],
        ],
      ]),
    );
    const db = new SheetDB({
      tables: [table] as const,
      gateway: new InMemoryGateway(store),
      cacheService: new InMemoryCacheService(),
      utilities: new NodeUtilities(),
    });

    db.table("users");
    const taro = {
      id: 1,
      name: "taro",
      version: 1,
    };
    taro.name = "yamada";

    const updated = db.update([taro]);

    expect(updated).toEqual([
      {
        id: 1,
        name: "yamada",
        version: 2,
      },
    ]);
    expect(store.dump()).toEqual([
      ["id", "name", "version"],
      [1, "yamada", 2],
    ]);
  });

  it("returns updated entities with incremented version during transaction", () => {
    const schema = z.object({
      id: z.number().meta({ primary: true }),
      name: z.string(),
      version: z.number(),
    });
    const table = new SheetTable({
      dbId: "db",
      name: "users",
      schema,
      primaryKey: "id",
      versionColumn: "version",
    });

    const store = new InMemoryDataStore(
      new Map([
        [
          "db:users",
          [
            ["id", "name", "version"],
            [1, "taro", 1],
          ],
        ],
      ]),
    );
    const db = new SheetDB({
      tables: [table] as const,
      gateway: new InMemoryGateway(store),
      cacheService: new InMemoryCacheService(),
      utilities: new NodeUtilities(),
    });

    const result = db.transaction(() => {
      db.table("users");
      const taro = {
        id: 1,
        name: "taro",
        version: 1,
      };
      taro.name = "yamada";

      return db.update([taro]);
    });

    expect(result).toEqual([
      {
        id: 1,
        name: "yamada",
        version: 2,
      },
    ]);
    expect(store.dump()).toEqual([
      ["id", "name", "version"],
      [1, "yamada", 2],
    ]);
  });

  it("upsert inserts new rows for auto-increment tables when primary key is empty", () => {
    const schema = z.object({
      id: z.number().meta({ primary: true, autoIncrement: true }),
      name: z.string(),
    });
    const table = new SheetTable({
      dbId: "db",
      name: "users",
      schema,
      primaryKey: "id",
      autoNumbering: "increment",
    });

    const store = new InMemoryDataStore(
      new Map([
        [
          "db:users",
          [
            ["id", "name"],
            [1, "taro"],
          ],
        ],
      ]),
    );
    const db = new SheetDB({
      tables: [table] as const,
      gateway: new InMemoryGateway(store),
      cacheService: new InMemoryCacheService(),
      utilities: new NodeUtilities(),
    });

    db.table("users");
    const result = db.upsert([
      {
        name: "hanako",
        id: 0,
      },
    ]);

    expect(result).toEqual([
      {
        id: 2,
        name: "hanako",
      },
    ]);
    expect(store.dump()).toEqual([
      ["id", "name"],
      [1, "taro"],
      [2, "hanako"],
    ]);
  });

  it("upsert keeps input order when create and update are mixed", () => {
    const schema = z.object({
      id: z.number().meta({ primary: true }),
      name: z.string(),
    });
    const table = new SheetTable({
      dbId: "db",
      name: "users",
      schema,
      primaryKey: "id",
    });

    const store = new InMemoryDataStore(
      new Map([
        [
          "db:users",
          [
            ["id", "name"],
            [1, "taro"],
          ],
        ],
      ]),
    );
    const db = new SheetDB({
      tables: [table] as const,
      gateway: new InMemoryGateway(store),
      cacheService: new InMemoryCacheService(),
      utilities: new NodeUtilities(),
    });

    db.table("users");
    const result = db.upsert([
      {
        id: 2,
        name: "hanako",
      },
      {
        id: 1,
        name: "yamada",
      },
    ]);

    expect(result).toEqual([
      {
        id: 2,
        name: "hanako",
      },
      {
        id: 1,
        name: "yamada",
      },
    ]);
    expect(store.dump()).toEqual([
      ["id", "name"],
      [1, "yamada"],
      [2, "hanako"],
    ]);
  });

  it("upsert commits during transaction", () => {
    const schema = z.object({
      id: z.number().meta({ primary: true }),
      name: z.string(),
    });
    const table = new SheetTable({
      dbId: "db",
      name: "users",
      schema,
      primaryKey: "id",
    });

    const store = new InMemoryDataStore(
      new Map([
        [
          "db:users",
          [
            ["id", "name"],
            [1, "taro"],
          ],
        ],
      ]),
    );
    const db = new SheetDB({
      tables: [table] as const,
      gateway: new InMemoryGateway(store),
      cacheService: new InMemoryCacheService(),
      utilities: new NodeUtilities(),
    });

    db.transaction(() => {
      db.table("users");
      db.upsert([
        {
          id: 2,
          name: "hanako",
        },
        {
          id: 1,
          name: "yamada",
        },
      ]);
    });

    expect(store.dump()).toEqual([
      ["id", "name"],
      [1, "yamada"],
      [2, "hanako"],
    ]);
  });

  it("upsert throws when a create entry violates a unique constraint", () => {
    const schema = z.object({
      id: z.number().meta({ primary: true }),
      email: z.string().meta({ unique: true }),
    });
    const table = new SheetTable({
      dbId: "db",
      name: "users",
      schema,
      primaryKey: "id",
    });

    const store = new InMemoryDataStore(
      new Map([
        [
          "db:users",
          [
            ["id", "email"],
            [1, "a@example.com"],
          ],
        ],
      ]),
    );
    const db = new SheetDB({
      tables: [table] as const,
      gateway: new InMemoryGateway(store),
      cacheService: new InMemoryCacheService(),
      utilities: new NodeUtilities(),
    });

    db.table("users");

    expect(() =>
      db.upsert([
        {
          id: 2,
          email: "a@example.com",
        },
      ]),
    ).toThrow("Unique constraint violation: email=a@example.com");
  });

  it("upsert throws when optimistic lock version is stale", () => {
    const schema = z.object({
      id: z.number().meta({ primary: true }),
      name: z.string(),
      version: z.number(),
    });
    const table = new SheetTable({
      dbId: "db",
      name: "users",
      schema,
      primaryKey: "id",
      versionColumn: "version",
    });

    const store = new InMemoryDataStore(
      new Map([
        [
          "db:users",
          [
            ["id", "name", "version"],
            [1, "taro", 1],
          ],
        ],
      ]),
    );
    const db = new SheetDB({
      tables: [table] as const,
      gateway: new InMemoryGateway(store),
      cacheService: new InMemoryCacheService(),
      utilities: new NodeUtilities(),
    });

    db.table("users");

    expect(() =>
      db.upsert([
        {
          id: 1,
          name: "yamada",
          version: 0,
        },
      ]),
    ).toThrow("Optimistic lock error: expected version 1 but got 0");
  });

  it("upsert throws when primary key is missing on non-auto-increment tables", () => {
    const schema = z.object({
      id: z.number().meta({ primary: true }),
      name: z.string(),
    });
    const table = new SheetTable({
      dbId: "db",
      name: "users",
      schema,
      primaryKey: "id",
    });

    const store = new InMemoryDataStore(
      new Map([["db:users", [["id", "name"]]]]),
    );
    const db = new SheetDB({
      tables: [table] as const,
      gateway: new InMemoryGateway(store),
      cacheService: new InMemoryCacheService(),
      utilities: new NodeUtilities(),
    });

    db.table("users");

    expect(() =>
      db.upsert([
        {
          id: undefined as any,
          name: "hanako",
        },
      ]),
    ).toThrow("Primary key is required for upsert.");
  });

  it("deletes child records when onDelete is cascade", () => {
    const userSchema = z.object({
      id: z.string().meta({ primary: true }),
    });

    const employeeSchema = z.object({
      userId: z.string(),
    });

    const userTable = new SheetTable({
      dbId: "db",
      name: "users",
      schema: userSchema,
      primaryKey: "id",
    });
    const employeeTable = new SheetTable({
      dbId: "db",
      name: "employees",
      schema: employeeSchema,
      primaryKey: "userId",
    });

    employeeTable.reference("userId", userTable, "id", "cascade");

    const store = new InMemoryDataStore();
    store.set("db:users", [["id"], ["1"]]);
    store.set("db:employees", [["userId"], ["1"]]);

    const db = new SheetDB({
      tables: [userTable, employeeTable] as const,
      gateway: new InMemoryGateway(store),
      cacheService: new InMemoryCacheService(),
      utilities: new NodeUtilities(),
    });

    db.table("users").delete(["1", "2"]);

    db.table("users");

    expect(store.get("db:users").rows).toEqual([]);
    expect(store.get("db:employees").rows).toEqual([]);
  });

  describe("migrate", () => {
    it("各migration対象table自身をlockしてreleaseする", () => {
      const userSchema = z.object({
        id: z.number().meta({ primary: true }),
        name: z.string(),
      });

      const postSchema = z.object({
        id: z.number().meta({ primary: true }),
        title: z.string(),
      });

      const userTable = new SheetTable({
        dbId: "db",
        name: "users",
        schema: userSchema,
        primaryKey: "id",
      });
      const postTable = new SheetTable({
        dbId: "db",
        name: "posts",
        schema: postSchema,
        primaryKey: "id",
      });

      const store = new InMemoryDataStore(
        new Map([
          ["db:users", [["id", "name"]]],
          ["db:posts", [["id", "title"]]],
        ]),
      );

      const db = new SheetDB({
        tables: [userTable, postTable] as const,
        gateway: new InMemoryGateway(store),
        cacheService: new InMemoryCacheService(),
        utilities: new NodeUtilities(),
      });

      const userLock = vi.spyOn(userTable, "lock");
      const userRelease = vi.spyOn(userTable, "releaseLock");
      const postLock = vi.spyOn(postTable, "lock");
      const postRelease = vi.spyOn(postTable, "releaseLock");

      db.table("users");
      db.migrate();

      expect(userLock).toHaveBeenCalledTimes(1);
      expect(userRelease).toHaveBeenCalledTimes(1);
      expect(postLock).toHaveBeenCalledTimes(1);
      expect(postRelease).toHaveBeenCalledTimes(1);
    });
  });

  describe("seed", () => {
    it("lock取得後に空判定してinsertする", () => {
      const schema = z.object({
        id: z.number().meta({ primary: true }),
        name: z.string(),
      });

      const table = new SheetTable({
        dbId: "db",
        name: "users",
        schema,
        primaryKey: "id",
      });

      const store = new InMemoryDataStore(
        new Map([["db:users", [["id", "name"]]]]),
      );

      const gateway = new InMemoryGateway(store);

      const db = new SheetDB({
        tables: [table] as const,
        gateway,
        cacheService: new InMemoryCacheService(),
        utilities: new NodeUtilities(),
      });

      const calls: string[] = [];

      vi.spyOn(table, "lock").mockImplementation(() => {
        calls.push("lock");
      });

      vi.spyOn(gateway, "count").mockImplementation(() => {
        calls.push("count");
        return 0;
      });

      vi.spyOn(gateway, "insert").mockImplementation(() => {
        calls.push("insert");
      });

      vi.spyOn(table, "releaseLock").mockImplementation(() => {
        calls.push("release");
      });

      db.seed("users", [{ id: 1, name: "user" }]);

      expect(calls).toEqual(["lock", "count", "insert", "release"]);
    });
  });

  it("transaction内のcascade delete後に後続commandが失敗した場合は子孫までrollbackする", () => {
    const parentSchema = z.object({ id: z.number().meta({ primary: true }) });
    const childSchema = z.object({
      id: z.number().meta({ primary: true }),
      parentId: z.number(),
    });
    const grandChildSchema = z.object({
      id: z.number().meta({ primary: true }),
      childId: z.number(),
    });
    const otherSchema = z.object({
      id: z.number().meta({ primary: true }),
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
    const grandChildTable = new SheetTable({
      dbId: "db",
      name: "grand_children",
      schema: grandChildSchema,
      primaryKey: "id",
    });
    const otherTable = new SheetTable({
      dbId: "db",
      name: "others",
      schema: otherSchema,
      primaryKey: "id",
    });

    childTable.reference("parentId", parentTable, "id", "cascade");
    grandChildTable.reference("childId", childTable, "id", "cascade");

    const store = new InMemoryDataStore(
      new Map([
        ["db:parents", [["id"], [1], [2]]],
        [
          "db:children",
          [
            ["id", "parentId"],
            [10, 1],
            [20, 2],
          ],
        ],
        [
          "db:grand_children",
          [
            ["id", "childId"],
            [100, 10],
            [200, 20],
          ],
        ],
        ["db:others", [["id", "name"]]],
      ]),
    );

    const db = new SheetDB({
      tables: [parentTable, childTable, grandChildTable, otherTable] as const,
      gateway: new InMemoryGateway(store),
      cacheService: new InMemoryCacheService(),
      utilities: new NodeUtilities(),
    });

    expect(() =>
      db.transaction(() => {
        db.table("parents").delete([1]);

        db.table("others").create([
          {
            id: 1,
            name: 123,
          } as any,
        ]);
      }),
    ).toThrow();

    expect(store.get("db:parents").rows).toEqual([[1], [2]]);
    expect(store.get("db:children").rows).toEqual([
      [10, 1],
      [20, 2],
    ]);
    expect(store.get("db:grand_children").rows).toEqual([
      [100, 10],
      [200, 20],
    ]);
    expect(store.get("db:others").rows).toEqual([]);
  });

  it("transaction内のset null delete後に後続commandが失敗した場合は外部キーもrollbackする", () => {
    const parentSchema = z.object({ id: z.number().meta({ primary: true }) });
    const childSchema = z.object({
      id: z.number().meta({ primary: true }),
      parentId: z.number().nullable(),
    });
    const otherSchema = z.object({
      id: z.number().meta({ primary: true }),
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
    const otherTable = new SheetTable({
      dbId: "db",
      name: "others",
      schema: otherSchema,
      primaryKey: "id",
    });

    childTable.reference("parentId", parentTable, "id", "set null");

    const store = new InMemoryDataStore(
      new Map([
        ["db:parents", [["id"], [1], [2]]],
        [
          "db:children",
          [
            ["id", "parentId"],
            [10, 1],
            [20, 2],
          ],
        ],
        ["db:others", [["id", "name"]]],
      ]),
    );

    const db = new SheetDB({
      tables: [parentTable, childTable, otherTable] as const,
      gateway: new InMemoryGateway(store),
      cacheService: new InMemoryCacheService(),
      utilities: new NodeUtilities(),
    });

    expect(() =>
      db.transaction(() => {
        db.table("parents").delete([1]);

        db.table("others").create([
          {
            id: 1,
            name: 123,
          } as any,
        ]);
      }),
    ).toThrow();

    expect(store.get("db:parents").rows).toEqual([[1], [2]]);
    expect(store.get("db:children").rows).toEqual([
      [10, 1],
      [20, 2],
    ]);
    expect(store.get("db:others").rows).toEqual([]);
  });

  it("queryを@gasboost/queryで解決する", async () => {
    const userSchema = z.object({
      id: z.number().meta({ primary: true }),
      name: z.string(),
    });

    const userTable = new SheetTable({
      dbId: "db",
      name: "users",
      schema: userSchema,
      primaryKey: "id",
    });

    const store = new InMemoryDataStore(
      new Map([
        [
          "db:users",
          [
            ["id", "name"],
            [1, "Alice"],
            [2, "Bob"],
          ],
        ],
      ]),
    );
    const db = new SheetDB({
      tables: [userTable] as const,
      gateway: new InMemoryGateway(store),
      cacheService: new InMemoryCacheService(),
      utilities: new NodeUtilities(),
    });

    const query = db.query("users").and("name", "=", ["Alice"]);

    const records = await db.find(query);

    expect(records).toEqual([
      {
        id: 1,
        name: "Alice",
      },
    ]);
  });

  it("joinを@gasboost/queryで解決する", async () => {
    const userSchema = z.object({
      id: z.number().meta({ primary: true }),
      name: z.string(),
    });

    const postSchema = z.object({
      id: z.number().meta({ primary: true }),
      userId: z.number(),
      title: z.string(),
    });

    const userTable = new SheetTable({
      dbId: "db",
      name: "users",
      schema: userSchema,
      primaryKey: "id",
    });

    const postTable = new SheetTable({
      dbId: "db",
      name: "posts",
      schema: postSchema,
      primaryKey: "id",
    });

    const store = new InMemoryDataStore(
      new Map([
        [
          "db:users",
          [
            ["id", "name"],
            [1, "Alice"],
            [2, "Bob"],
          ],
        ],
        [
          "db:posts",
          [
            ["id", "userId", "title"],
            [10, 1, "Post 1"],
            [11, 1, "Post 2"],
            [12, 2, "Post 3"],
          ],
        ],
      ]),
    );

    const db = new SheetDB({
      tables: [userTable, postTable] as const,
      gateway: new InMemoryGateway(store),
      cacheService: new InMemoryCacheService(),
      utilities: new NodeUtilities(),
    });

    const query = db.query("users").join("id", "posts", "userId");

    const records = await db.find(query);

    expect(records).toEqual([
      {
        id: 1,
        name: "Alice",
        relations: {
          posts: [
            {
              id: 10,
              userId: 1,
              title: "Post 1",
            },
            {
              id: 11,
              userId: 1,
              title: "Post 2",
            },
          ],
        },
      },
      {
        id: 2,
        name: "Bob",
        relations: {
          posts: [
            {
              id: 12,
              userId: 2,
              title: "Post 3",
            },
          ],
        },
      },
    ]);
  });
});
