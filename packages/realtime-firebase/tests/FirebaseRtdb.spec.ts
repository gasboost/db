import {
  allow,
  and,
  column,
  eq,
  literal,
  principal,
  RowLevelSecurity,
} from "@gasboost/rls";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FirebaseRtdb } from "../src";

const principalSchema = z.object({
  userId: z.string(),
  storeId: z.string(),
});

const dealSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  storeId: z.string(),
  status: z.string(),
  title: z.string(),
});

const deals = {
  name: "deals",
  schema: dealSchema,
  primaryKey: "id",
} as const;

describe("FirebaseRtdb", () => {
  it("table accessorを生成する", () => {
    const security = new RowLevelSecurity({
      table: deals,
      select: {
        using: eq(
          column(deals, "ownerId"),
          principal(principalSchema, "userId"),
        ),
      },
    });

    const rtdb = FirebaseRtdb.generate({
      tables: [deals] as const,
      rowLevelSecurity: [security],
      principal: {
        userId: "auth.uid",
        storeId: "auth.token.storeId",
      },
    });

    expect(rtdb.deals).toBe(rtdb.table("deals"));
  });

  it("record pathをRLSから生成する", () => {
    const security = new RowLevelSecurity({
      table: deals,
      select: {
        using: eq(
          column(deals, "ownerId"),
          principal(principalSchema, "userId"),
        ),
      },
    });

    const rtdb = FirebaseRtdb.generate({
      tables: [deals] as const,
      rowLevelSecurity: [security],
      principal: {
        userId: "auth.uid",
        storeId: "auth.token.storeId",
      },
    });

    expect(
      rtdb.deals.record({
        id: "deal-1",
        ownerId: "user-1",
        storeId: "store-1",
        status: "open",
        title: "Deal",
      }),
    ).toBe("/deals/__rls/ownerId/user-1/deal-1");
  });

  it("subscription scopeをprincipalから生成する", () => {
    const security = new RowLevelSecurity({
      table: deals,
      select: {
        using: eq(
          column(deals, "ownerId"),
          principal(principalSchema, "userId"),
        ),
      },
    });

    const rtdb = FirebaseRtdb.generate({
      tables: [deals] as const,
      rowLevelSecurity: [security],
      principal: {
        userId: "auth.uid",
        storeId: "auth.token.storeId",
      },
    });

    expect(
      rtdb.deals.scope({
        userId: "user-1",
        storeId: "store-1",
      }),
    ).toBe("/deals/__rls/ownerId/user-1");
  });

  it("複数partitionをANDから導出する", () => {
    const security = new RowLevelSecurity({
      table: deals,
      select: {
        using: and(
          eq(column(deals, "ownerId"), principal(principalSchema, "userId")),
          eq(column(deals, "storeId"), principal(principalSchema, "storeId")),
        ),
      },
    });

    const rtdb = FirebaseRtdb.generate({
      tables: [deals] as const,
      rowLevelSecurity: [security],
      principal: {
        userId: "auth.uid",
        storeId: "auth.token.storeId",
      },
    });

    expect(
      rtdb.deals.scope({
        userId: "user-1",
        storeId: "store-1",
      }),
    ).toBe("/deals/__rls/ownerId/user-1/storeId/store-1");
  });

  it("literal partitionを生成する", () => {
    const security = new RowLevelSecurity({
      table: deals,
      select: {
        using: and(
          eq(column(deals, "ownerId"), principal(principalSchema, "userId")),
          eq(column(deals, "status"), literal("open")),
        ),
      },
    });

    const rtdb = FirebaseRtdb.generate({
      tables: [deals] as const,
      rowLevelSecurity: [security],
      principal: {
        userId: "auth.uid",
        storeId: "auth.token.storeId",
      },
    });

    expect(
      rtdb.deals.scope({
        userId: "user-1",
        storeId: "store-1",
      }),
    ).toBe("/deals/__rls/ownerId/user-1/status/open");
  });

  it("literal partitionとrecordの不一致を拒否する", () => {
    const security = new RowLevelSecurity({
      table: deals,
      select: {
        using: eq(column(deals, "status"), literal("open")),
      },
    });

    const rtdb = FirebaseRtdb.generate({
      tables: [deals] as const,
      rowLevelSecurity: [security],
      principal: {
        userId: "auth.uid",
        storeId: "auth.token.storeId",
      },
    });

    expect(() =>
      rtdb.deals.record({
        id: "deal-1",
        ownerId: "user-1",
        storeId: "store-1",
        status: "closed",
        title: "Deal",
      }),
    ).toThrow("RLS partition column 'status' must equal \"open\".");
  });

  it("RLSなしtableはroot scopeを利用する", () => {
    const rtdb = FirebaseRtdb.generate({
      tables: [deals] as const,
      principal: {
        userId: "auth.uid",
        storeId: "auth.token.storeId",
      },
    });

    expect(
      rtdb.deals.scope({
        userId: "user-1",
        storeId: "store-1",
      }),
    ).toBe("/deals");

    expect(
      rtdb.deals.record({
        id: "deal-1",
        ownerId: "user-1",
        storeId: "store-1",
        status: "open",
        title: "Deal",
      }),
    ).toBe("/deals/deal-1");
  });

  it("selectなしtableはscopeを公開しない", () => {
    const security = new RowLevelSecurity({
      table: deals,
      insert: {
        check: allow(),
      },
    });

    const rtdb = FirebaseRtdb.generate({
      tables: [deals] as const,
      rowLevelSecurity: [security],
      principal: {
        userId: "auth.uid",
        storeId: "auth.token.storeId",
      },
    });

    expect(() =>
      rtdb.deals.scope({
        userId: "user-1",
        storeId: "store-1",
      }),
    ).toThrow("Table 'deals' does not define a readable RLS scope.");
  });

  it("selectのorは単一scopeへ投影しない", () => {
    const security = new RowLevelSecurity({
      table: deals,
      select: {
        using: {
          type: "or",
          conditions: [
            eq(column(deals, "ownerId"), principal(principalSchema, "userId")),
            eq(column(deals, "status"), literal("public")),
          ],
        },
      },
    });

    expect(() =>
      FirebaseRtdb.generate({
        tables: [deals] as const,
        rowLevelSecurity: [security],
        principal: {
          userId: "auth.uid",
          storeId: "auth.token.storeId",
        },
      }),
    ).toThrow(
      "uses or(), which cannot be projected to a single RTDB subscription scope.",
    );
  });

  it("principal mapping不足を拒否する", () => {
    const security = new RowLevelSecurity({
      table: deals,
      select: {
        using: eq(
          column(deals, "ownerId"),
          principal(principalSchema, "userId"),
        ),
      },
    });

    expect(() =>
      FirebaseRtdb.generate({
        tables: [deals] as const,
        rowLevelSecurity: [security],
        principal: {
          storeId: "auth.token.storeId",
        },
      }),
    ).toThrow("Firebase principal mapping for 'userId' is not defined.");
  });
});
