import { InMemoryCacheService } from "@gasboost/fake-core";
import { NodeUtilities } from "@gasboost/fake-node";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DeleteCommand } from "../../src/commands/DeleteCommand";
import { SheetDB } from "../../src/core/SheetDB";
import { SheetTable } from "../../src/core/SheetTable";
import { InMemoryGateway } from "../../src/gateway/InMemoryGateway";
import { InMemoryDataStore } from "../../src/storage/InMemoryDataStore";

describe("SheetDB", () => {
  it("skips deleteCascade when no relations", () => {
    const schema = z.object({ id: z.number().meta({ primary: true }) });
    const table = new SheetTable("db", "users", schema, "id", false);

    const store = new InMemoryDataStore(
      new Map([["db:users", [["id"], [1], [2]]]]),
    );
    const db = new SheetDB(
      [table],
      new InMemoryGateway(store),
      new InMemoryCacheService(),
      new NodeUtilities(),
    );

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

    const userTable = new SheetTable("db", "users", userSchema, "id", false);

    const postTable = new SheetTable("db", "posts", postSchema, "id", false);

    const profileTable = new SheetTable(
      "db",
      "profiles",
      profileSchema,
      "id",
      false,
    );

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
    const db = new SheetDB(
      [userTable, postTable, profileTable],
      new InMemoryGateway(store),
      new InMemoryCacheService(),
      new NodeUtilities(),
    );

    db.table("users");
    expect(() => db.delete([1])).not.toThrow();
  });

  it("handles duplicate cascade relations", () => {
    const userSchema = z.object({ id: z.number().meta({ primary: true }) });
    const childSchema = z.object({
      id: z.number().meta({ primary: true }),
      userId: z.number(),
    });

    const userTable = new SheetTable("db", "users", userSchema, "id", false);

    const childTable = new SheetTable(
      "db",
      "children",
      childSchema,
      "id",
      false,
    );

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
    const db = new SheetDB(
      [userTable, childTable],
      new InMemoryGateway(store),
      new InMemoryCacheService(),
      new NodeUtilities(),
    );

    db.table("users");
    expect(() => db.delete([1])).not.toThrow();
  });

  it("commits delete diff during transaction", () => {
    const schema = z.object({ id: z.number().meta({ primary: true }) });
    const table = new SheetTable("db", "users", schema, "id", false);

    const store = new InMemoryDataStore(
      new Map([["db:users", [["id"], [1], [2]]]]),
    );
    const db = new SheetDB(
      [table],
      new InMemoryGateway(store),
      new InMemoryCacheService(),
      new NodeUtilities(),
    );

    db.transaction(() => {
      db.table("users");
      db.delete([1]);
    });

    db.table("users");
    expect(db.find().length).toBe(1);
  });

  it("commits delete diff when called directly", () => {
    const schema = z.object({ id: z.number().meta({ primary: true }) });
    const table = new SheetTable("db", "users", schema, "id", false);

    const store = new InMemoryDataStore(
      new Map([["db:users", [["id"], [1], [2]]]]),
    );
    const db = new SheetDB(
      [table],
      new InMemoryGateway(store),
      new InMemoryCacheService(),
      new NodeUtilities(),
    );

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
    expect(db.find().map((row) => row[table.primaryKey])).toEqual([2]);
  });

  it("updates one row without removing the others", () => {
    const schema = z.object({
      id: z.number().meta({ primary: true }),
      name: z.string(),
    });
    const table = new SheetTable("db", "users", schema, "id", false);

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
    const db = new SheetDB(
      [table],
      new InMemoryGateway(store),
      new InMemoryCacheService(),
      new NodeUtilities(),
    );

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
    const table = new SheetTable("db", "users", schema, "id", false, {
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
    const db = new SheetDB(
      [table],
      new InMemoryGateway(store),
      new InMemoryCacheService(),
      new NodeUtilities(),
    );

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
    const table = new SheetTable("db", "users", schema, "id", false, {
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
    const db = new SheetDB(
      [table],
      new InMemoryGateway(store),
      new InMemoryCacheService(),
      new NodeUtilities(),
    );

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
    const table = new SheetTable("db", "users", schema, "id", true);

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
    const db = new SheetDB(
      [table],
      new InMemoryGateway(store),
      new InMemoryCacheService(),
      new NodeUtilities(),
    );

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
    const table = new SheetTable("db", "users", schema, "id", false);

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
    const db = new SheetDB(
      [table],
      new InMemoryGateway(store),
      new InMemoryCacheService(),
      new NodeUtilities(),
    );

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
    const table = new SheetTable("db", "users", schema, "id", false);

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
    const db = new SheetDB(
      [table],
      new InMemoryGateway(store),
      new InMemoryCacheService(),
      new NodeUtilities(),
    );

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
    const table = new SheetTable("db", "users", schema, "id", false);

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
    const db = new SheetDB(
      [table],
      new InMemoryGateway(store),
      new InMemoryCacheService(),
      new NodeUtilities(),
    );

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
    const table = new SheetTable("db", "users", schema, "id", false, {
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
    const db = new SheetDB(
      [table],
      new InMemoryGateway(store),
      new InMemoryCacheService(),
      new NodeUtilities(),
    );

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
    const table = new SheetTable("db", "users", schema, "id", false);

    const store = new InMemoryDataStore(
      new Map([["db:users", [["id", "name"]]]]),
    );
    const db = new SheetDB(
      [table],
      new InMemoryGateway(store),
      new InMemoryCacheService(),
      new NodeUtilities(),
    );

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

    const userTable = new SheetTable("db", "users", userSchema, "id", false);

    const employeeTable = new SheetTable(
      "db",
      "employees",
      employeeSchema,
      "userId",
      false,
    );

    employeeTable.reference("userId", userTable, "id", "cascade");

    const store = new InMemoryDataStore();
    store.set("db:users", [["id"], ["1"]]);
    store.set("db:employees", [["userId"], ["1"]]);

    const db = new SheetDB(
      [userTable, employeeTable],
      new InMemoryGateway(store),
      new InMemoryCacheService(),
      new NodeUtilities(),
    );

    db.table("users").delete(["1", "2"]);

    db.table("users");

    expect(store.get("db:users").rows).toEqual([]);
    expect(store.get("db:employees").rows).toEqual([]);
  });
});
