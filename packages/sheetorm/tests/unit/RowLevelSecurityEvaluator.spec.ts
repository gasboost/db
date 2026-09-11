import {
  allow,
  column,
  eq,
  literal,
  principal,
  RowLevelSecurity,
} from "@gasboost/rls";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RowLevelSecurityEvaluator } from "../../src/core/RowLevelSecurityEvaluator";

const users = {
  name: "users",
  schema: z.object({
    id: z.string(),
    ownerId: z.string(),
    enabled: z.boolean(),
  }),
} as const;

const principalSchema = z.object({
  userId: z.string(),
});

describe("RowLevelSecurityEvaluator", () => {
  it("RLSがないTableでは全Recordを返す", () => {
    const records = [
      {
        id: "1",
        ownerId: "user-1",
        enabled: true,
      },
      {
        id: "2",
        ownerId: "user-2",
        enabled: true,
      },
    ];

    const evaluator = new RowLevelSecurityEvaluator({
      principal: {
        userId: "user-1",
      },
      policies: [],
      load: () => records,
    });

    expect(evaluator.read(users)).toEqual(records);
  });

  it("select policyがない場合はdefault denyする", () => {
    const records = [
      {
        id: "1",
        ownerId: "user-1",
        enabled: true,
      },
    ];

    const evaluator = new RowLevelSecurityEvaluator({
      principal: {
        userId: "user-1",
      },
      policies: [
        new RowLevelSecurity({
          table: users,
        }),
      ],
      load: () => records,
    });

    expect(evaluator.read(users)).toEqual([]);
  });

  it("allow() は全Recordを許可する", () => {
    const records = [
      {
        id: "1",
        ownerId: "user-1",
        enabled: true,
      },
      {
        id: "2",
        ownerId: "user-2",
        enabled: false,
      },
    ];

    const evaluator = new RowLevelSecurityEvaluator({
      principal: {
        userId: "user-1",
      },
      policies: [
        new RowLevelSecurity({
          table: users,
          select: {
            using: allow(),
          },
        }),
      ],
      load: () => records,
    });

    expect(evaluator.read(users)).toEqual(records);
  });

  it("column と principal を比較できる", () => {
    const records = [
      {
        id: "1",
        ownerId: "user-1",
        enabled: true,
      },
      {
        id: "2",
        ownerId: "user-2",
        enabled: true,
      },
    ];

    const evaluator = new RowLevelSecurityEvaluator({
      principal: {
        userId: "user-1",
      },
      policies: [
        new RowLevelSecurity({
          table: users,
          select: {
            using: eq(
              column(users, "ownerId"),
              principal(principalSchema, "userId"),
            ),
          },
        }),
      ],
      load: () => records,
    });

    expect(evaluator.read(users)).toEqual([
      {
        id: "1",
        ownerId: "user-1",
        enabled: true,
      },
    ]);
  });

  it("literal を評価できる", () => {
    const records = [
      {
        id: "1",
        ownerId: "user-1",
        enabled: true,
      },
      {
        id: "2",
        ownerId: "user-1",
        enabled: false,
      },
    ];

    const evaluator = new RowLevelSecurityEvaluator({
      principal: {
        userId: "user-1",
      },
      policies: [
        new RowLevelSecurity({
          table: users,
          select: {
            using: eq(column(users, "enabled"), literal(true)),
          },
        }),
      ],
      load: () => records,
    });

    expect(evaluator.read(users)).toEqual([
      {
        id: "1",
        ownerId: "user-1",
        enabled: true,
      },
    ]);
  });
});
