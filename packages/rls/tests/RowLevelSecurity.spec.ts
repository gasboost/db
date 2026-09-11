import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  and,
  column,
  eq,
  exists,
  literal,
  or,
  outerColumn,
  principal,
  RowLevelSecurity,
} from "../src";

const DealSchema = z.object({
  id: z.string(),
  salesPersonId: z.string(),
  amount: z.number(),
});

const AssignmentSchema = z.object({
  managerId: z.string(),
  subordinateId: z.string(),
});

const deals = {
  name: "deals",
  schema: DealSchema,
} as const;

const assignments = {
  name: "assignments",
  schema: AssignmentSchema,
} as const;

const principalSchema = z.object({
  userId: z.string(),
  role: z.enum(["sales", "manager"]),
});

describe("RLS expressions", () => {
  it("columnはtableとcolumnをASTとして保持する", () => {
    expect(column(deals, "salesPersonId")).toEqual({
      type: "column",
      table: "deals",
      column: "salesPersonId",
    });
  });

  it("principalはprincipalのkeyをASTとして保持する", () => {
    expect(principal(principalSchema, "userId")).toEqual({
      type: "principal",
      key: "userId",
    });
  });

  it("literalは値をASTとして保持する", () => {
    expect(literal(100)).toEqual({
      type: "literal",
      value: 100,
    });
  });

  it("eqは左右の式をASTとして保持する", () => {
    expect(
      eq(column(deals, "salesPersonId"), principal(principalSchema, "userId")),
    ).toEqual({
      type: "eq",
      left: {
        type: "column",
        table: "deals",
        column: "salesPersonId",
      },
      right: {
        type: "principal",
        key: "userId",
      },
    });
  });

  it("orは複数predicateを保持する", () => {
    const first = eq(
      column(deals, "salesPersonId"),
      principal(principalSchema, "userId"),
    );

    const second = eq(column(deals, "amount"), literal(100));

    expect(or(first, second)).toEqual({
      type: "or",
      conditions: [first, second],
    });
  });

  it("andは複数predicateを保持する", () => {
    const first = eq(
      column(assignments, "managerId"),
      principal(principalSchema, "userId"),
    );

    const second = eq(
      column(assignments, "subordinateId"),
      outerColumn(deals, "salesPersonId"),
    );

    expect(and(first, second)).toEqual({
      type: "and",
      conditions: [first, second],
    });
  });

  it("existsは参照tableとconditionを保持する", () => {
    const condition = eq(
      column(assignments, "managerId"),
      principal(principalSchema, "userId"),
    );

    expect(exists(assignments, condition)).toEqual({
      type: "exists",
      table: assignments,
      condition,
    });
  });
});

describe("RowLevelSecurity", () => {
  it("operationごとのpolicyを保持する", () => {
    const using = eq(
      column(deals, "salesPersonId"),
      principal(principalSchema, "userId"),
    );

    const security = new RowLevelSecurity({
      table: deals,
      select: {
        using,
      },
      insert: {
        check: using,
      },
      update: {
        using,
        check: using,
      },
      delete: {
        using,
      },
    });

    expect(security.table).toBe(deals);
    expect(security.select).toEqual({ using });
    expect(security.insert).toEqual({ check: using });
    expect(security.update).toEqual({
      using,
      check: using,
    });
    expect(security.delete).toEqual({ using });
  });

  it("未指定operationはnullになる", () => {
    const security = new RowLevelSecurity({
      table: deals,
      select: {
        using: eq(
          column(deals, "salesPersonId"),
          principal(principalSchema, "userId"),
        ),
      },
    });

    expect(security.select).not.toBeNull();
    expect(security.insert).toBeNull();
    expect(security.update).toBeNull();
    expect(security.delete).toBeNull();
  });
});
