import {
  allow,
  column,
  eq,
  exists,
  literal,
  or,
  outerColumn,
  principal,
  RowLevelSecurity,
} from "@gasboost/rls";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FirebaseRtdb } from "../src";

const principalSchema = z.object({
  userId: z.string(),
});

const dealSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  status: z.string(),
});

const deals = {
  name: "deals",
  schema: dealSchema,
  primaryKey: "id",
} as const;

describe("FirebaseRtdb projectability", () => {
  it("orはrecord-level Security Rulesへ変換できる", () => {
    const security = new RowLevelSecurity({
      table: deals,
      select: {
        using: allow(),
      },
      insert: {
        check: or(
          eq(column(deals, "ownerId"), principal(principalSchema, "userId")),
          eq(column(deals, "status"), literal("public")),
        ),
      },
    });

    const rtdb = FirebaseRtdb.generate({
      tables: [deals] as const,
      rowLevelSecurity: [security],
      principal: {
        userId: "auth.uid",
      },
    });

    const rules = rtdb.rules();
    const record = (rules.rules.deals as any).$recordId;

    expect(record[".write"]).toContain(
      'newData.child("ownerId").val() === auth.uid',
    );

    expect(record[".write"]).toContain(
      'newData.child("status").val() === "public"',
    );

    expect(record[".write"]).toContain(" || ");
  });

  it("orを含むselectは単一subscription scopeへ投影しない", () => {
    const security = new RowLevelSecurity({
      table: deals,
      select: {
        using: or(
          eq(column(deals, "ownerId"), principal(principalSchema, "userId")),
          eq(column(deals, "status"), literal("public")),
        ),
      },
    });

    expect(() =>
      FirebaseRtdb.generate({
        tables: [deals] as const,
        rowLevelSecurity: [security],
        principal: {
          userId: "auth.uid",
        },
      }),
    ).toThrow(
      "uses or(), which cannot be projected to a single RTDB subscription scope.",
    );
  });

  it("existsを含むselectは明示的にprojectability errorにする", () => {
    const security = new RowLevelSecurity({
      table: deals,
      select: {
        using: exists(
          deals,
          eq(column(deals, "ownerId"), principal(principalSchema, "userId")),
        ),
      },
    });

    expect(() =>
      FirebaseRtdb.generate({
        tables: [deals] as const,
        rowLevelSecurity: [security],
        principal: {
          userId: "auth.uid",
        },
      }),
    ).toThrow(
      "uses exists(), which cannot currently be projected to an RTDB subscription scope.",
    );
  });

  it("existsを含むwrite policyはRules生成時に明示的に拒否する", () => {
    const security = new RowLevelSecurity({
      table: deals,
      select: {
        using: allow(),
      },
      insert: {
        check: exists(deals, allow()),
      },
    });

    const rtdb = FirebaseRtdb.generate({
      tables: [deals] as const,
      rowLevelSecurity: [security],
      principal: {
        userId: "auth.uid",
      },
    });

    expect(() => rtdb.rules()).toThrow(
      "exists() cannot currently be compiled to Firebase RTDB Security Rules.",
    );
  });

  it("outerColumnを含むselectは明示的にprojectability errorにする", () => {
    const security = new RowLevelSecurity({
      table: deals,
      select: {
        using: eq(column(deals, "ownerId"), outerColumn(deals, "ownerId")),
      },
    });

    expect(() =>
      FirebaseRtdb.generate({
        tables: [deals] as const,
        rowLevelSecurity: [security],
        principal: {
          userId: "auth.uid",
        },
      }),
    ).toThrow(
      "uses outerColumn(), which cannot currently be projected to an RTDB subscription scope.",
    );
  });

  it("outerColumnを含むwrite policyはRules生成時に明示的に拒否する", () => {
    const security = new RowLevelSecurity({
      table: deals,
      select: {
        using: allow(),
      },
      insert: {
        check: eq(column(deals, "ownerId"), outerColumn(deals, "ownerId")),
      },
    });

    const rtdb = FirebaseRtdb.generate({
      tables: [deals] as const,
      rowLevelSecurity: [security],
      principal: {
        userId: "auth.uid",
      },
    });

    expect(() => rtdb.rules()).toThrow(
      "outerColumn() cannot currently be compiled to Firebase RTDB Security Rules.",
    );
  });
});
