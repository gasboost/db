import {
  allow,
  and,
  column,
  eq,
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
  title: z.string(),
});

const deals = {
  name: "deals",
  schema: dealSchema,
  primaryKey: "id",
} as const;

describe("FirebaseRtdb rules", () => {
  it("RLSなしtableはunrestrictedになる", () => {
    const rtdb = FirebaseRtdb.generate({
      tables: [deals] as const,
      principal: {
        userId: "auth.uid",
        storeId: "auth.token.storeId",
      },
    });

    expect(rtdb.rules()).toEqual({
      rules: {
        deals: {
          ".read": true,
          ".write": true,
        },
      },
    });
  });

  it("owner RLSをscope rulesへ変換する", () => {
    const owner = eq(
      column(deals, "ownerId"),
      principal(principalSchema, "userId"),
    );

    const security = new RowLevelSecurity({
      table: deals,
      select: {
        using: owner,
      },
      insert: {
        check: owner,
      },
      update: {
        using: owner,
        check: owner,
      },
      delete: {
        using: owner,
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

    const rules = rtdb.rules();

    const scope = (rules.rules.deals as any).__rls.ownerId.$scope0;

    expect(scope[".read"]).toBe(
      "auth != null && ($scope0 === (auth.uid + ''))",
    );

    expect(scope.$recordId[".read"]).toBe(
      'auth != null && (data.child("ownerId").val() === auth.uid)',
    );

    expect(scope.$recordId[".write"]).toContain(
      "!data.exists() && newData.exists()",
    );

    expect(scope.$recordId[".write"]).toContain(
      "data.exists() && newData.exists()",
    );

    expect(scope.$recordId[".write"]).toContain(
      "data.exists() && !newData.exists()",
    );
  });

  it("未定義operationはdenyする", () => {
    const owner = eq(
      column(deals, "ownerId"),
      principal(principalSchema, "userId"),
    );

    const security = new RowLevelSecurity({
      table: deals,
      select: {
        using: owner,
      },
      insert: {
        check: owner,
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

    const record = (rtdb.rules().rules.deals as any).__rls.ownerId.$scope0
      .$recordId;

    expect(record[".write"]).toContain(
      "data.exists() && newData.exists() && false",
    );

    expect(record[".write"]).toContain(
      "data.exists() && !newData.exists() && false",
    );
  });

  it("allowをexplicit allowとして変換する", () => {
    const security = new RowLevelSecurity({
      table: deals,
      select: {
        using: allow(),
      },
      insert: {
        check: allow(),
      },
      update: {
        using: allow(),
        check: allow(),
      },
      delete: {
        using: allow(),
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

    const dealsRules = rtdb.rules().rules.deals as any;

    expect(dealsRules[".read"]).toBe("true");

    expect(dealsRules.$recordId[".read"]).toBe("true");
  });

  it("AND principal scopeを生成する", () => {
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

    const scope = (rtdb.rules().rules.deals as any).__rls.ownerId.$scope0
      .storeId.$scope1;

    expect(scope[".read"]).toBe(
      "auth != null && (($scope0 === (auth.uid + '')) && ($scope1 === (auth.token.storeId + '')))",
    );
  });
});
