import { InMemoryCacheService } from "@gasboost/fake-core";
import { NodeUtilities } from "@gasboost/fake-node";
import { RowLevelSecurity, allow } from "@gasboost/rls";
import { it } from "vitest";
import { z } from "zod";
import { SheetDB } from "../../src/core/SheetDB";
import { SheetTable } from "../../src/core/SheetTable";
import { InMemoryGateway } from "../../src/gateway/InMemoryGateway";
import { InMemoryDataStore } from "../../src/storage/InMemoryDataStore";

it("rejects RLS for a table outside SheetDB tables", () => {
  const userSchema = z.object({
    id: z.number(),
  });

  const orderSchema = z.object({
    id: z.number(),
  });

  const users = new SheetTable({
    dbId: "db",
    name: "users",
    schema: userSchema,
    primaryKey: "id",
  });

  const orders = new SheetTable({
    dbId: "db",
    name: "orders",
    schema: orderSchema,
    primaryKey: "id",
  });

  const ordersRls = new RowLevelSecurity({
    table: orders,
    select: {
      using: allow(),
    },
  });

  new SheetDB({
    tables: [users] as const,
    gateway: new InMemoryGateway(
      new InMemoryDataStore(new Map([["db:users", [["id"]]]])),
    ),
    cacheService: new InMemoryCacheService(),
    utilities: new NodeUtilities(),

    // @ts-expect-error RLS table must belong to SheetDB tables
    rowLevelSecurity: [ordersRls],
  });
});
