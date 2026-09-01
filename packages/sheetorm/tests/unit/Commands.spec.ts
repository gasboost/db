import { InMemoryCacheService } from "@gasboost/fake-core";
import { NodeUtilities } from "@gasboost/fake-node";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CreateCommand } from "../../src/commands/CreateCommand";
import { DeleteCommand } from "../../src/commands/DeleteCommand";
import { UpdateCommand } from "../../src/commands/UpdateCommand";
import { SheetRecords } from "../../src/core/SheetRecords";
import { SheetTable } from "../../src/core/SheetTable";
import { InMemoryGateway } from "../../src/gateway/InMemoryGateway";
import { InMemoryDataStore } from "../../src/storage/InMemoryDataStore";

describe("Command coverage", () => {
  it("CreateCommand falls back to lastId when cache is invalid", () => {
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
            [2, "a"],
          ],
        ],
      ]),
    );
    const gateway = new InMemoryGateway(store);
    const cacheService = new InMemoryCacheService();
    const utilities = new NodeUtilities();
    cacheService.getScriptCache().put("db:users:autoIncrement", "not-json");

    const command = new CreateCommand(gateway, table, cacheService, utilities, [
      { name: "b" },
    ]);

    const diff = command.getDiff();
    expect(diff[0].id).toBe(3);
  });

  it("CreateCommand uses cached auto-increment value when valid", () => {
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
            [2, "a"],
          ],
        ],
      ]),
    );
    const gateway = new InMemoryGateway(store);
    const cacheService = new InMemoryCacheService();

    const cache = cacheService.getScriptCache();
    cache.put("db:users:autoIncrement", JSON.stringify({ value: 10 }));

    vi.spyOn(cacheService, "getScriptCache").mockReturnValue(cache);

    const utilities = new NodeUtilities();

    expect(cacheService.getScriptCache().get("db:users:autoIncrement")).toBe(
      JSON.stringify({ value: 10 }),
    );

    const command = new CreateCommand(gateway, table, cacheService, utilities, [
      { name: "b" },
      { name: "c" },
    ]);

    const diff = command.getDiff();
    expect(diff.map((row) => row.id)).toEqual([11, 12]);
  });

  it("CreateCommand falls back to lastId when cache is empty", () => {
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
            [5, "a"],
          ],
        ],
      ]),
    );
    const gateway = new InMemoryGateway(store);
    const cacheService = new InMemoryCacheService();
    const utilities = new NodeUtilities();

    const command = new CreateCommand(gateway, table, cacheService, utilities, [
      { name: "b" },
    ]);

    const diff = command.getDiff();
    expect(diff[0].id).toBe(6);
  });

  it("CreateCommand keeps params when autoIncrement is disabled", () => {
    const schema = z.object({
      id: z.number().meta({ primary: true }),
      name: z.string(),
    });
    const table = new SheetTable("db", "users", schema, "id", false);

    const command = new CreateCommand(
      new InMemoryGateway(
        new InMemoryDataStore(new Map([["db:users", [["id", "name"]]]])),
      ),
      table,
      new InMemoryCacheService(),
      new NodeUtilities(),
      [{ id: 7, name: "b" }],
    );

    const diff = command.getDiff();
    expect(diff[0].id).toBe(7);
    expect(diff[0].name).toBe("b");
  });

  it("CreateCommand uses uuid auto-numbering when configured", () => {
    const schema = z.object({
      id: z.string().meta({ primary: true, autoIncrement: true }),
      name: z.string(),
    });
    const table = new SheetTable("db", "users", schema, "id", true, {
      autoNumberingMode: "uuid",
    });

    const utilities = new NodeUtilities();
    vi.spyOn(utilities, "getUuid")
      .mockImplementationOnce(() => "uuid-1")
      .mockImplementationOnce(() => "uuid-2");

    const command = new CreateCommand(
      new InMemoryGateway(
        new InMemoryDataStore(new Map([["db:users", [["id", "name"]]]])),
      ),
      table,
      new InMemoryCacheService(),
      utilities,
      [{ name: "b" }, { name: "c" }],
    );

    const diff = command.getDiff();
    expect(diff.map((row) => row.id)).toEqual(["uuid-1", "uuid-2"]);
  });

  it("CreateCommand uses uuid auto-numbering for related child records", () => {
    const parentSchema = z.object({
      id: z.string().meta({ primary: true, autoIncrement: true }),
      name: z.string(),
    });
    const childSchema = z.object({
      id: z.string().meta({ primary: true, autoIncrement: true }),
      parentId: z.string(),
      name: z.string(),
    });
    const parentTable = new SheetTable(
      "db",
      "parents",
      parentSchema,
      "id",
      true,
      { autoNumberingMode: "uuid" },
    );
    const childTable = new SheetTable(
      "db",
      "children",
      childSchema,
      "id",
      true,
      { autoNumberingMode: "uuid" },
    );

    childTable.reference("parentId", parentTable, "id", "cascade");

    const store = new InMemoryDataStore(
      new Map([
        ["db:parents", [["id", "name"]]],
        ["db:children", [["id", "parentId", "name"]]],
      ]),
    );
    const gateway = new InMemoryGateway(store);
    const utilities = new NodeUtilities();

    gateway.table("parents", "db");
    const exsist = new SheetRecords(
      gateway.read(),
      parentTable.primaryKey as string,
    );
    const command = new CreateCommand(
      gateway,
      parentTable,
      new InMemoryCacheService(),
      utilities,
      [
        {
          name: "parent",
          relations: {
            children: [{ name: "child-a" }, { name: "child-b" }],
          },
        },
      ],
    );

    command.execute(exsist);

    const parentRows = store.get("db:parents").rows;
    const childRows = store.get("db:children").rows;

    expect(parentRows).toHaveLength(1);
    expect(childRows).toHaveLength(2);
    expect(parentRows[0][1]).toBe("parent");
    expect(childRows[0][1]).toBe(parentRows[0][0]);
    expect(childRows[1][1]).toBe(parentRows[0][0]);
    expect(childRows[0][2]).toBe("child-a");
    expect(childRows[1][2]).toBe("child-b");
    expect(childRows[0][0]).not.toBe(parentRows[0][0]);
    expect(childRows[1][0]).not.toBe(parentRows[0][0]);
    expect(childRows[0][0]).not.toBe(childRows[1][0]);
  });

  it("CreateCommandはgetDiffとexecuteを通して各RecordのUUIDを1回だけ生成する", () => {
    const parentSchema = z.object({
      id: z.string().meta({ primary: true, autoIncrement: true }),
      name: z.string(),
    });
    const childSchema = z.object({
      id: z.string().meta({ primary: true, autoIncrement: true }),
      parentId: z.string(),
      name: z.string(),
    });

    const parentTable = new SheetTable(
      "db",
      "parents",
      parentSchema,
      "id",
      true,
      { autoNumberingMode: "uuid" },
    );
    const childTable = new SheetTable(
      "db",
      "children",
      childSchema,
      "id",
      true,
      { autoNumberingMode: "uuid" },
    );

    childTable.reference("parentId", parentTable, "id", "cascade");

    const store = new InMemoryDataStore(
      new Map([
        ["db:parents", [["id", "name"]]],
        ["db:children", [["id", "parentId", "name"]]],
      ]),
    );
    const gateway = new InMemoryGateway(store);

    const getUuid = vi
      .fn()
      .mockReturnValueOnce("parent-uuid")
      .mockReturnValueOnce("child-a-uuid")
      .mockReturnValueOnce("child-b-uuid");

    const utilities = new NodeUtilities();
    vi.spyOn(utilities, "getUuid").mockImplementation(getUuid);

    gateway.table("parents", "db");
    const exsist = new SheetRecords(
      gateway.read(),
      parentTable.primaryKey as string,
    );

    const command = new CreateCommand(
      gateway,
      parentTable,
      new InMemoryCacheService(),
      utilities,
      [
        {
          name: "parent",
          relations: {
            children: [{ name: "child-a" }, { name: "child-b" }],
          },
        },
      ],
    );

    const preview = command.getDiff();

    expect(preview[0].id).toBe("parent-uuid");
    expect(preview[0].relations.children.map((child: any) => child.id)).toEqual(
      ["child-a-uuid", "child-b-uuid"],
    );

    command.execute(exsist);

    const result = command.getDiff();

    expect(result[0].relations.children.map((child: any) => child.id)).toEqual([
      "child-a-uuid",
      "child-b-uuid",
    ]);

    expect(getUuid).toHaveBeenCalledTimes(3);
  });
  it("CreateCommand starts from 1 when lastId is 0", () => {
    const schema = z.object({
      id: z.number().meta({ primary: true, autoIncrement: true }),
      name: z.string(),
    });
    const table = new SheetTable("db", "users", schema, "id", true);

    const store = new InMemoryDataStore(
      new Map([["db:users", [["id", "name"]]]]),
    );
    const gateway = new InMemoryGateway(store);
    const cacheService = new InMemoryCacheService();
    const utilities = new NodeUtilities();

    const command = new CreateCommand(gateway, table, cacheService, utilities, [
      { name: "first" },
    ]);

    const diff = command.getDiff();
    expect(diff[0].id).toBe(1);
  });

  it("CreateCommand throws on unique violation with existing", () => {
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
    const gateway = new InMemoryGateway(store);
    gateway.table("users", "db");
    const exsist = new SheetRecords(gateway.read(), table.primaryKey as string);
    const command = new CreateCommand(
      gateway,
      table,
      new InMemoryCacheService(),
      new NodeUtilities(),
      [{ id: 2, email: "a@example.com" }],
    );

    expect(() => command.execute(exsist)).toThrow(
      "Unique constraint violation: email=a@example.com",
    );
  });

  it("CreateCommand detects duplicates in same batch", () => {
    const schema = z.object({
      id: z.number().meta({ primary: true }),
      email: z.string().meta({ unique: true }),
    });
    const table = new SheetTable("db", "users", schema, "id", false);

    const store = new InMemoryDataStore(
      new Map([["db:users", [["id", "email"]]]]),
    );
    const gateway = new InMemoryGateway(store);
    gateway.table("users", "db");
    const exsist = new SheetRecords(gateway.read(), table.primaryKey as string);
    const command = new CreateCommand(
      gateway,
      table,
      new InMemoryCacheService(),
      new NodeUtilities(),
      [
        { id: 1, email: "dup@example.com" },
        { id: 2, email: "dup@example.com" },
      ],
    );

    expect(() => command.execute(exsist)).toThrow(
      "Unique constraint violation: email=dup@example.com",
    );
  });

  it("CreateCommand allows null or undefined unique values", () => {
    const schema = z.object({
      id: z.number().meta({ primary: true }),
      email: z.string().optional().meta({ unique: true }),
    });
    const table = new SheetTable("db", "users", schema, "id", false);

    const store = new InMemoryDataStore(
      new Map([["db:users", [["id", "email"]]]]),
    );
    const gateway = new InMemoryGateway(store);
    gateway.table("users", "db");
    const exsist = new SheetRecords(gateway.read(), table.primaryKey as string);
    const command = new CreateCommand(
      gateway,
      table,
      new InMemoryCacheService(),
      new NodeUtilities(),
      [{ id: 1 }, { id: 2 }],
    );

    expect(() => command.execute(exsist)).not.toThrow();
  });

  it("CreateCommand ignores blank unique values and undefined existing values", () => {
    const schema = z.object({
      id: z.number().meta({ primary: true }),
      email: z.string().meta({ unique: true }),
    });
    const table = new SheetTable("db", "users", schema, "id", false);

    const store = new InMemoryDataStore(
      new Map([["db:users", [["id", "email"], [1, "   "], [2]]]]),
    );
    const gateway = new InMemoryGateway(store);
    gateway.table("users", "db");
    const exsist = new SheetRecords(gateway.read(), table.primaryKey as string);
    const command = new CreateCommand(
      gateway,
      table,
      new InMemoryCacheService(),
      new NodeUtilities(),
      [
        { id: 3, email: "   " },
        { id: 4, email: "ok@example.com" },
      ],
    );

    expect(() => command.execute(exsist)).not.toThrow();
    gateway.table("users", "db");
    expect(gateway.count()).toBe(4);
  });

  it("UpdateCommand allows same unique value for same record", () => {
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
    const gateway = new InMemoryGateway(store);
    gateway.table("users", "db");
    const exsist = new SheetRecords(gateway.read(), table.primaryKey as string);
    const command = new UpdateCommand(
      table,
      gateway,
      new InMemoryCacheService(),
      new NodeUtilities(),
      [{ id: 1, email: "a@example.com" }],
    );

    expect(() => command.execute(exsist)).not.toThrow();
  });

  it("UpdateCommand throws when changing to existing unique value", () => {
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
            [2, "b@example.com"],
          ],
        ],
      ]),
    );
    const gateway = new InMemoryGateway(store);
    gateway.table("users", "db");
    const exsist = new SheetRecords(gateway.read(), table.primaryKey as string);
    const command = new UpdateCommand(
      table,
      gateway,
      new InMemoryCacheService(),
      new NodeUtilities(),
      [{ id: 1, email: "b@example.com" }],
    );

    expect(() => command.execute(exsist)).toThrow(
      "Unique constraint violation: email=b@example.com",
    );
  });

  it("UpdateCommand ignores null and blank unique values", () => {
    const schema = z.object({
      id: z.number().meta({ primary: true }),
      email: z.string().nullable().optional().meta({ unique: true }),
    });
    const table = new SheetTable("db", "users", schema, "id", false);

    const store = new InMemoryDataStore(
      new Map([
        [
          "db:users",
          [
            ["id", "email"],
            [1, "a@example.com"],
            [2, "b@example.com"],
          ],
        ],
      ]),
    );
    const gateway = new InMemoryGateway(store);
    gateway.table("users", "db");
    const exsist = new SheetRecords(gateway.read(), table.primaryKey as string);
    const command = new UpdateCommand(
      table,
      gateway,
      new InMemoryCacheService(),
      new NodeUtilities(),
      [
        { id: 1, email: null },
        { id: 2, email: "   " },
      ],
    );

    expect(() => command.execute(exsist)).not.toThrow();
    gateway.table("users", "db");
    expect(gateway.read()).toEqual([
      { id: 1, email: null },
      { id: 2, email: "   " },
    ]);
  });

  it("DeleteCommand throws when exsist is missing", () => {
    const schema = z.object({ id: z.number().meta({ primary: true }) });
    const table = new SheetTable("db", "users", schema, "id", false);

    const command = new DeleteCommand(
      table,
      new InMemoryGateway(
        new InMemoryDataStore(new Map([["db:users", [["id"], [1]]]])),
      ),
      new InMemoryCacheService(),
      new NodeUtilities(),
      [1],
    );

    expect(() => command.execute(undefined as any)).toThrow(
      "Exsist data is required for delete",
    );
  });
});
