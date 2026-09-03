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
      { name: "b", id: 0 },
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
      { name: "b", id: 0 },
      { name: "c", id: 0 },
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
      { name: "b", id: 0 },
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
      [
        { name: "b", id: "" },
        { name: "c", id: "" },
      ],
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
          id: "",
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
          id: "",
        },
      ],
    );

    const preview = command.getDiff();

    expect(preview[0].id).toBe("parent-uuid");
    expect(
      (preview[0] as any).relations.children.map((child: any) => child.id),
    ).toEqual(["child-a-uuid", "child-b-uuid"]);

    command.execute(exsist);

    const result = command.getDiff();

    expect(
      (result[0] as any).relations.children.map((child: any) => child.id),
    ).toEqual(["child-a-uuid", "child-b-uuid"]);

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
      { name: "first", id: 0 },
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

  describe("DeleteCommandの参照整合性", () => {
    it("restrict対象の子Recordが存在する場合は親を削除せず親子とも変更しない", () => {
      const parentSchema = z.object({
        id: z.number().meta({ primary: true }),
        name: z.string(),
      });
      const childSchema = z.object({
        id: z.number().meta({ primary: true }),
        parentId: z.number(),
        name: z.string(),
      });

      const parentTable = new SheetTable(
        "db",
        "parents",
        parentSchema,
        "id",
        false,
      );
      const childTable = new SheetTable(
        "db",
        "children",
        childSchema,
        "id",
        false,
      );

      childTable.reference("parentId", parentTable, "id", "restrict");

      const store = new InMemoryDataStore(
        new Map([
          [
            "db:parents",
            [
              ["id", "name"],
              [1, "parent"],
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
      );

      const gateway = new InMemoryGateway(store);
      gateway.table("parents", "db");

      const records = new SheetRecords(
        gateway.read(),
        parentTable.primaryKey as string,
      );

      const command = new DeleteCommand(
        parentTable,
        gateway,
        new InMemoryCacheService(),
        new NodeUtilities(),
        [1],
      );

      expect(() => command.execute(records)).toThrow();

      expect(store.get("db:parents").rows).toEqual([[1, "parent"]]);
      expect(store.get("db:children").rows).toEqual([[10, 1, "child"]]);
    });

    it("restrict対象の子Recordが存在しない場合は親を削除できる", () => {
      const parentSchema = z.object({
        id: z.number().meta({ primary: true }),
        name: z.string(),
      });
      const childSchema = z.object({
        id: z.number().meta({ primary: true }),
        parentId: z.number(),
        name: z.string(),
      });

      const parentTable = new SheetTable(
        "db",
        "parents",
        parentSchema,
        "id",
        false,
      );
      const childTable = new SheetTable(
        "db",
        "children",
        childSchema,
        "id",
        false,
      );

      childTable.reference("parentId", parentTable, "id", "restrict");

      const store = new InMemoryDataStore(
        new Map([
          [
            "db:parents",
            [
              ["id", "name"],
              [1, "parent-1"],
              [2, "parent-2"],
            ],
          ],
          [
            "db:children",
            [
              ["id", "parentId", "name"],
              [10, 2, "child"],
            ],
          ],
        ]),
      );

      const gateway = new InMemoryGateway(store);
      gateway.table("parents", "db");

      const records = new SheetRecords(
        gateway.read(),
        parentTable.primaryKey as string,
      );

      const command = new DeleteCommand(
        parentTable,
        gateway,
        new InMemoryCacheService(),
        new NodeUtilities(),
        [1],
      );

      command.execute(records);

      expect(store.get("db:parents").rows).toEqual([[2, "parent-2"]]);
      expect(store.get("db:children").rows).toEqual([[10, 2, "child"]]);
    });

    it("cascadeは子・孫・曾孫までそれぞれ直前の親キーを使って削除する", () => {
      const parentSchema = z.object({
        id: z.number().meta({ primary: true }),
      });
      const childSchema = z.object({
        id: z.number().meta({ primary: true }),
        parentId: z.number(),
      });
      const grandChildSchema = z.object({
        id: z.number().meta({ primary: true }),
        childId: z.number(),
      });
      const greatGrandChildSchema = z.object({
        id: z.number().meta({ primary: true }),
        grandChildId: z.number(),
      });

      const parentTable = new SheetTable(
        "db",
        "parents",
        parentSchema,
        "id",
        false,
      );
      const childTable = new SheetTable(
        "db",
        "children",
        childSchema,
        "id",
        false,
      );
      const grandChildTable = new SheetTable(
        "db",
        "grand_children",
        grandChildSchema,
        "id",
        false,
      );
      const greatGrandChildTable = new SheetTable(
        "db",
        "great_grand_children",
        greatGrandChildSchema,
        "id",
        false,
      );

      childTable.reference("parentId", parentTable, "id", "cascade");
      grandChildTable.reference("childId", childTable, "id", "cascade");
      greatGrandChildTable.reference(
        "grandChildId",
        grandChildTable,
        "id",
        "cascade",
      );

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
          [
            "db:great_grand_children",
            [
              ["id", "grandChildId"],
              [1000, 100],
              [2000, 200],
            ],
          ],
        ]),
      );

      const gateway = new InMemoryGateway(store);
      gateway.table("parents", "db");

      const records = new SheetRecords(
        gateway.read(),
        parentTable.primaryKey as string,
      );

      const command = new DeleteCommand(
        parentTable,
        gateway,
        new InMemoryCacheService(),
        new NodeUtilities(),
        [1],
      );

      command.execute(records);

      expect(store.get("db:parents").rows).toEqual([[2]]);
      expect(store.get("db:children").rows).toEqual([[20, 2]]);
      expect(store.get("db:grand_children").rows).toEqual([[200, 20]]);
      expect(store.get("db:great_grand_children").rows).toEqual([[2000, 200]]);
    });

    it("cascadeのsibling relationをそれぞれ削除する", () => {
      const parentSchema = z.object({
        id: z.number().meta({ primary: true }),
      });
      const childASchema = z.object({
        id: z.number().meta({ primary: true }),
        parentId: z.number(),
      });
      const childBSchema = z.object({
        id: z.number().meta({ primary: true }),
        parentId: z.number(),
      });

      const parentTable = new SheetTable(
        "db",
        "parents",
        parentSchema,
        "id",
        false,
      );
      const childATable = new SheetTable(
        "db",
        "children_a",
        childASchema,
        "id",
        false,
      );
      const childBTable = new SheetTable(
        "db",
        "children_b",
        childBSchema,
        "id",
        false,
      );

      childATable.reference("parentId", parentTable, "id", "cascade");
      childBTable.reference("parentId", parentTable, "id", "cascade");

      const store = new InMemoryDataStore(
        new Map([
          ["db:parents", [["id"], [1], [2]]],
          [
            "db:children_a",
            [
              ["id", "parentId"],
              [10, 1],
              [20, 2],
            ],
          ],
          [
            "db:children_b",
            [
              ["id", "parentId"],
              [30, 1],
              [40, 2],
            ],
          ],
        ]),
      );

      const gateway = new InMemoryGateway(store);
      gateway.table("parents", "db");

      const records = new SheetRecords(
        gateway.read(),
        parentTable.primaryKey as string,
      );

      new DeleteCommand(
        parentTable,
        gateway,
        new InMemoryCacheService(),
        new NodeUtilities(),
        [1],
      ).execute(records);

      expect(store.get("db:parents").rows).toEqual([[2]]);
      expect(store.get("db:children_a").rows).toEqual([[20, 2]]);
      expect(store.get("db:children_b").rows).toEqual([[40, 2]]);
    });

    it("cascade先にrestrict対象が存在する場合は削除全体を失敗させる", () => {
      const parentSchema = z.object({
        id: z.number().meta({ primary: true }),
      });
      const childSchema = z.object({
        id: z.number().meta({ primary: true }),
        parentId: z.number(),
      });
      const grandChildSchema = z.object({
        id: z.number().meta({ primary: true }),
        childId: z.number(),
      });

      const parentTable = new SheetTable(
        "db",
        "parents",
        parentSchema,
        "id",
        false,
      );
      const childTable = new SheetTable(
        "db",
        "children",
        childSchema,
        "id",
        false,
      );
      const grandChildTable = new SheetTable(
        "db",
        "grand_children",
        grandChildSchema,
        "id",
        false,
      );

      childTable.reference("parentId", parentTable, "id", "cascade");
      grandChildTable.reference("childId", childTable, "id", "restrict");

      const store = new InMemoryDataStore(
        new Map([
          ["db:parents", [["id"], [1]]],
          [
            "db:children",
            [
              ["id", "parentId"],
              [10, 1],
            ],
          ],
          [
            "db:grand_children",
            [
              ["id", "childId"],
              [100, 10],
            ],
          ],
        ]),
      );

      const gateway = new InMemoryGateway(store);
      gateway.table("parents", "db");

      const records = new SheetRecords(
        gateway.read(),
        parentTable.primaryKey as string,
      );

      const command = new DeleteCommand(
        parentTable,
        gateway,
        new InMemoryCacheService(),
        new NodeUtilities(),
        [1],
      );

      expect(() => command.execute(records)).toThrow();

      // 途中までCASCADEされてはいけない
      expect(store.get("db:parents").rows).toEqual([[1]]);
      expect(store.get("db:children").rows).toEqual([[10, 1]]);
      expect(store.get("db:grand_children").rows).toEqual([[100, 10]]);
    });

    it("set nullは対象childの外部キーだけをnullにする", () => {
      const parentSchema = z.object({
        id: z.number().meta({ primary: true }),
      });
      const childSchema = z.object({
        id: z.number().meta({ primary: true }),
        parentId: z.number().nullable(),
      });

      const parentTable = new SheetTable(
        "db",
        "parents",
        parentSchema,
        "id",
        false,
      );
      const childTable = new SheetTable(
        "db",
        "children",
        childSchema,
        "id",
        false,
      );

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
        ]),
      );

      const gateway = new InMemoryGateway(store);
      gateway.table("parents", "db");

      const records = new SheetRecords(
        gateway.read(),
        parentTable.primaryKey as string,
      );

      new DeleteCommand(
        parentTable,
        gateway,
        new InMemoryCacheService(),
        new NodeUtilities(),
        [1],
      ).execute(records);

      expect(store.get("db:parents").rows).toEqual([[2]]);
      expect(store.get("db:children").rows).toEqual([
        [10, null],
        [20, 2],
      ]);
    });

    it("循環relationでも無限再帰しない", () => {
      const aSchema = z.object({
        id: z.number().meta({ primary: true }),
        bId: z.number().nullable(),
      });
      const bSchema = z.object({
        id: z.number().meta({ primary: true }),
        aId: z.number().nullable(),
      });

      const tableA = new SheetTable("db", "a", aSchema, "id", false);
      const tableB = new SheetTable("db", "b", bSchema, "id", false);

      tableB.reference("aId", tableA, "id", "cascade");
      tableA.reference("bId", tableB, "id", "cascade");

      const store = new InMemoryDataStore(
        new Map([
          [
            "db:a",
            [
              ["id", "bId"],
              [1, 10],
            ],
          ],
          [
            "db:b",
            [
              ["id", "aId"],
              [10, 1],
            ],
          ],
        ]),
      );

      const gateway = new InMemoryGateway(store);
      gateway.table("a", "db");

      const records = new SheetRecords(
        gateway.read(),
        tableA.primaryKey as string,
      );

      expect(() =>
        new DeleteCommand(
          tableA,
          gateway,
          new InMemoryCacheService(),
          new NodeUtilities(),
          [1],
        ).execute(records),
      ).not.toThrow();

      expect(store.get("db:a").rows).toEqual([]);
      expect(store.get("db:b").rows).toEqual([]);
    });

    it("自己参照cascadeで子・孫まで削除する", () => {
      const schema = z.object({
        id: z.number().meta({ primary: true }),
        parentId: z.number().nullable(),
      });

      const table = new SheetTable("db", "categories", schema, "id", false);

      table.reference("parentId", table, "id", "cascade");

      const store = new InMemoryDataStore(
        new Map([
          [
            "db:categories",
            [
              ["id", "parentId"],
              [1, null],
              [2, 1],
              [3, 2],
              [4, null],
            ],
          ],
        ]),
      );

      const gateway = new InMemoryGateway(store);
      gateway.table("categories", "db");

      const records = new SheetRecords(
        gateway.read(),
        table.primaryKey as string,
      );

      new DeleteCommand(
        table,
        gateway,
        new InMemoryCacheService(),
        new NodeUtilities(),
        [1],
      ).execute(records);

      expect(store.get("db:categories").rows).toEqual([[4, null]]);
    });
  });
});
