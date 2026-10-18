import { InMemoryCacheService } from "@gasboost/fake-core";
import { NodeUtilities } from "@gasboost/fake-node";
import {
  allow,
  column,
  eq,
  exists,
  outerColumn,
  principal,
  RowLevelSecurity,
} from "@gasboost/rls";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { SheetDB, SheetGateway, SheetTable } from "../../src";

function createContext(otherDbId = "db") {
  const stores = new SheetTable({
    dbId: "db",
    name: "stores",
    primaryKey: "id",
    schema: z.object({ id: z.number(), ownerId: z.string() }),
  });
  const products = new SheetTable({
    dbId: otherDbId,
    name: "products",
    primaryKey: "id",
    schema: z.object({ id: z.number(), storeId: z.number() }),
  });
  const orders = new SheetTable({
    dbId: "db",
    name: "orders",
    primaryKey: "id",
    schema: z.object({ id: z.number(), productId: z.number() }),
  });
  const secrets = new SheetTable({
    dbId: "db",
    name: "secrets",
    primaryKey: "id",
    schema: z.object({ id: z.number() }),
  });
  const empty = new SheetTable({
    dbId: "db",
    name: "empty",
    primaryKey: "id",
    schema: z.object({ id: z.number() }),
  });
  const values = new Map<string, unknown[][]>([
    [
      "stores",
      [
        ["id", "ownerId"],
        [1, "u1"],
        [2, "u2"],
      ],
    ],
    [
      "products",
      [
        ["id", "storeId"],
        [10, 1],
        [20, 2],
      ],
    ],
    [
      "orders",
      [
        ["id", "productId"],
        [100, 10],
        [200, 20],
      ],
    ],
    ["secrets", [["id"], [999]]],
    ["empty", []],
  ]);
  const batchGet = vi.fn((_dbId: string, options: { ranges: string[] }) => ({
    valueRanges: options.ranges.map((range) => ({
      values: values.get(range.slice(1, range.indexOf("'!"))),
    })),
  }));
  const gateway = new SheetGateway({
    Spreadsheets: { Values: { batchGet } },
  } as unknown as GoogleAppsScript.Sheets);
  const db = new SheetDB({
    tables: [stores, products, orders, secrets, empty] as const,
    gateway,
    cacheService: new InMemoryCacheService(),
    utilities: new NodeUtilities(),
    principal: { userId: "u1" },
    rowLevelSecurity: [
      new RowLevelSecurity({
        table: stores,
        select: {
          using: eq(
            column(stores, "ownerId"),
            principal(z.object({ userId: z.string() }), "userId"),
          ),
        },
      }),
      new RowLevelSecurity({
        table: products,
        select: {
          using: exists(
            stores,
            eq(column(stores, "id"), outerColumn(products, "storeId")),
          ),
        },
      }),
      new RowLevelSecurity({
        table: orders,
        select: {
          using: exists(
            products,
            eq(column(products, "id"), outerColumn(orders, "productId")),
          ),
        },
      }),
      new RowLevelSecurity({ table: secrets, insert: { check: allow() } }),
    ],
  });
  return { db, batchGet, values };
}

describe("SheetDB.findMany", () => {
  it("batches tables and applies each select policy, including default deny", () => {
    const { db, batchGet } = createContext();
    expect(
      db.findMany(["stores", "products", "orders", "secrets", "empty"]),
    ).toEqual({
      stores: [{ id: 1, ownerId: "u1" }],
      products: [{ id: 10, storeId: 1 }],
      orders: [{ id: 100, productId: 10 }],
      secrets: [],
      empty: [],
    });
    expect(batchGet).toHaveBeenCalledExactlyOnceWith("db", {
      ranges: [
        "'stores'!A:ZZZ",
        "'products'!A:ZZZ",
        "'orders'!A:ZZZ",
        "'secrets'!A:ZZZ",
        "'empty'!A:ZZZ",
      ],
      valueRenderOption: "UNFORMATTED_VALUE",
    });
  });

  it("loads transitive RLS dependencies but only returns requested tables", () => {
    const { db, batchGet } = createContext();
    expect(db.findMany(["orders"])).toEqual({
      orders: [{ id: 100, productId: 10 }],
    });
    expect(batchGet).toHaveBeenCalledExactlyOnceWith("db", {
      ranges: ["'orders'!A:ZZZ", "'products'!A:ZZZ", "'stores'!A:ZZZ"],
      valueRenderOption: "UNFORMATTED_VALUE",
    });
  });

  it("groups requested and dependency tables by spreadsheet", () => {
    const { db, batchGet } = createContext("catalog");
    expect(db.findMany(["orders", "products"])).toEqual({
      orders: [{ id: 100, productId: 10 }],
      products: [{ id: 10, storeId: 1 }],
    });
    expect(batchGet).toHaveBeenCalledTimes(2);
    expect(batchGet).toHaveBeenCalledWith("db", {
      ranges: ["'orders'!A:ZZZ", "'stores'!A:ZZZ"],
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    expect(batchGet).toHaveBeenCalledWith("catalog", {
      ranges: ["'products'!A:ZZZ"],
      valueRenderOption: "UNFORMATTED_VALUE",
    });
  });

  it("returns all rows when a table has no RLS policy", () => {
    const { db, values } = createContext();
    values.set("empty", [["id"], [1], [2]]);
    expect(db.findMany(["empty"])).toEqual({ empty: [{ id: 1 }, { id: 2 }] });
  });

  it("returns an empty object without Sheets calls for empty input", () => {
    const { db, batchGet } = createContext();
    expect(db.findMany([])).toEqual({});
    expect(batchGet).not.toHaveBeenCalled();
  });

  it("deduplicates requested tables and dependency reads", () => {
    const { db, batchGet } = createContext();
    expect(db.findMany(["products", "stores", "products"])).toEqual({
      products: [{ id: 10, storeId: 1 }],
      stores: [{ id: 1, ownerId: "u1" }],
    });
    expect(batchGet).toHaveBeenCalledExactlyOnceWith("db", {
      ranges: ["'products'!A:ZZZ", "'stores'!A:ZZZ"],
      valueRenderOption: "UNFORMATTED_VALUE",
    });
  });

  it("rejects unknown tables before reading from Sheets", () => {
    const { db, batchGet } = createContext();
    // @ts-expect-error unregistered table
    expect(() => db.findMany(["unknown"])).toThrow(
      "Table 'unknown' not found.",
    );
    expect(batchGet).not.toHaveBeenCalled();
  });

  it("preserves the selected table and does not cache results across calls", () => {
    const { db, values } = createContext();
    db.table("stores");
    db.findMany(["orders"]);
    expect(db.find()).toEqual([{ id: 1, ownerId: "u1" }]);
    values.set("orders", [
      ["id", "productId"],
      [300, 10],
    ]);
    expect(db.findMany(["orders"])).toEqual({
      orders: [{ id: 300, productId: 10 }],
    });
  });
});
