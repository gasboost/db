import { InMemoryCacheService } from "@gasboost/fake-core";
import { NodeUtilities } from "@gasboost/fake-node";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SheetDB } from "../../src/core/SheetDB";
import { SheetTable } from "../../src/core/SheetTable";
import { InMemoryGateway } from "../../src/gateway/InMemoryGateway";
import { InMemoryDataStore } from "../../src/storage/InMemoryDataStore";

describe("object-based constructors", () => {
  it("configures SheetTable with named properties", () => {
    const schema = z.object({
      id: z.number(),
      version: z.number(),
      name: z.string(),
    });

    const table = new SheetTable({
      dbId: "db",
      name: "users",
      schema,
      primaryKey: "id",
      autoNumbering: "increment",
      versionColumn: "version",
    });

    expect(table.dbId).toBe("db");
    expect(table.name).toBe("users");
    expect(table.primaryKey).toBe("id");
    expect(table.autoNumbering).toBe("increment");
    expect(table.versionColumn).toBe("version");
  });

  it("supports uuid auto-numbering without an autoIncrement flag", () => {
    const schema = z.object({ id: z.string(), name: z.string() });

    const table = new SheetTable({
      dbId: "db",
      name: "users",
      schema,
      primaryKey: "id",
      autoNumbering: "uuid",
    });

    expect(table.autoNumbering).toBe("uuid");
  });

  it("disables auto-numbering when autoNumbering is omitted", () => {
    const schema = z.object({ id: z.number(), name: z.string() });

    const table = new SheetTable({
      dbId: "db",
      name: "users",
      schema,
      primaryKey: "id",
    });

    expect(table.autoNumbering).toBeUndefined();
  });

  it("configures SheetDB dependencies with named properties", () => {
    const schema = z.object({ id: z.number(), name: z.string() });
    const table = new SheetTable({
      dbId: "db",
      name: "users",
      schema,
      primaryKey: "id",
    });
    const store = new InMemoryDataStore(
      new Map([["db:users", [["id", "name"], [1, "Alice"]]]]),
    );

    const db = new SheetDB({
      tables: [table] as const,
      gateway: new InMemoryGateway(store),
      cacheService: new InMemoryCacheService(),
      utilities: new NodeUtilities(),
    });

    expect(db.table("users").find()).toEqual([{ id: 1, name: "Alice" }]);
  });

  it("preserves table-name inference for SheetDB.table", () => {
    const userSchema = z.object({ id: z.number() });
    const postSchema = z.object({ id: z.number() });
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

    const db = new SheetDB({
      tables: [userTable, postTable] as const,
      gateway: new InMemoryGateway(new InMemoryDataStore()),
      cacheService: new InMemoryCacheService(),
      utilities: new NodeUtilities(),
    });

    expect(db.table("users")).toBe(db);
    expect(db.table("posts")).toBe(db);
  });
});
