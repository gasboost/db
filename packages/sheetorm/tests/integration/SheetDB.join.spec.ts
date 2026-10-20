import { InMemoryCacheService } from "@gasboost/fake-core";
import { NodeUtilities } from "@gasboost/fake-node";
import { column, eq, principal, RowLevelSecurity } from "@gasboost/rls";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SheetDB } from "../../src/core/SheetDB";
import { SheetTable } from "../../src/core/SheetTable";
import { InMemoryGateway } from "../../src/gateway/InMemoryGateway";
import { InMemoryDataStore } from "../../src/storage/InMemoryDataStore";

function createContext() {
  const employees = new SheetTable({
    dbId: "db",
    name: "employees",
    primaryKey: "id",
    schema: z.object({
      id: z.string(),
      userId: z.string(),
      departmentId: z.string(),
    }),
  });
  const users = new SheetTable({
    dbId: "db",
    name: "users",
    primaryKey: "id",
    schema: z.object({ id: z.string(), name: z.string(), tenant: z.string() }),
  });
  const departments = new SheetTable({
    dbId: "db",
    name: "departments",
    primaryKey: "id",
    schema: z.object({ id: z.string(), name: z.string(), tenant: z.string() }),
  });
  const principalSchema = z.object({ tenant: z.string() });
  const store = new InMemoryDataStore(
    new Map([
      [
        "db:employees",
        [
          ["id", "userId", "departmentId"],
          ["e0", "hidden", "d1"],
          ["e1", "u1", "d1"],
          ["e2", "u2", "d2"],
          ["e3", "missing", "d1"],
        ],
      ],
      [
        "db:users",
        [
          ["id", "name", "tenant"],
          ["hidden", "田中 秘密", "other"],
          ["u1", "田中 一郎", "mine"],
          ["u2", "田中 次郎", "mine"],
        ],
      ],
      [
        "db:departments",
        [
          ["id", "name", "tenant"],
          ["d1", "開発", "mine"],
          ["d2", "秘密部署", "other"],
        ],
      ],
    ]),
  );
  return new SheetDB({
    tables: [employees, users, departments] as const,
    gateway: new InMemoryGateway(store),
    cacheService: new InMemoryCacheService(),
    utilities: new NodeUtilities(),
    principal: { tenant: "mine" },
    rowLevelSecurity: [
      new RowLevelSecurity({
        table: users,
        select: {
          using: eq(
            column(users, "tenant"),
            principal(principalSchema, "tenant"),
          ),
        },
      }),
      new RowLevelSecurity({
        table: departments,
        select: {
          using: eq(
            column(departments, "tenant"),
            principal(principalSchema, "tenant"),
          ),
        },
      }),
    ],
  });
}

describe("SheetDB object JOIN integration", () => {
  it("filters employees using visible users, then pages, while LEFT preserves an empty restricted relation", () => {
    const db = createContext();
    const query = db
      .query("employees")
      .join({
        table: "users",
        on: { local: "userId", reference: "id" },
        query: db.query("users").and("name", "*", ["田中"]),
        type: "inner",
      })
      .join({
        table: "departments",
        on: { local: "departmentId", reference: "id" },
        type: "left",
      })
      .orderBy("id")
      .offset(1)
      .limit(1);
    expect(db.find(query)).toEqual([
      {
        id: "e2",
        userId: "u2",
        departmentId: "d2",
        relations: {
          users: [{ id: "u2", name: "田中 次郎", tenant: "mine" }],
          departments: [],
        },
      },
    ]);
  });

  it("does not expose parents whose matching user was denied by RLS", () => {
    const db = createContext();
    const query = db
      .query("employees")
      .join({
        table: "users",
        on: { local: "userId", reference: "id" },
        type: "inner",
      });
    const records = db.find(query);
    expect(records.map((record) => record.id)).toEqual(["e1", "e2"]);
    expect(records.map((record) => record.relations.users[0].name)).toEqual([
      "田中 一郎",
      "田中 次郎",
    ]);
  });

  it("applies nested INNER and RLS before the subquery pagination", () => {
    const db = createContext();
    const subquery = db
      .query("employees")
      .join({
        table: "departments",
        on: { local: "departmentId", reference: "id" },
        type: "inner",
      })
      .orderBy("id")
      .offset(1)
      .limit(1);
    const records = db.find(
      db.query("users").join({
        table: "employees",
        on: { local: "id", reference: "userId" },
        query: subquery,
        type: "inner",
      }),
    );
    expect(records).toEqual([
      {
        id: "u1",
        name: "田中 一郎",
        tenant: "mine",
        relations: {
          employees: [
            {
              id: "e1",
              userId: "u1",
              departmentId: "d1",
              relations: {
                departments: [{ id: "d1", name: "開発", tenant: "mine" }],
              },
            },
          ],
        },
      },
    ]);
  });

  it("keeps positional and object LEFT results and pagination identical under RLS", () => {
    const db = createContext();
    const legacy = db.find(
      db
        .query("employees")
        .join("userId", "users", "id")
        .orderBy("id")
        .limit(1),
    );
    const object = db.find(
      db
        .query("employees")
        .join({ table: "users", on: { local: "userId", reference: "id" } })
        .orderBy("id")
        .limit(1),
    );
    expect(object).toEqual(legacy);
    expect(object).toEqual([
      {
        id: "e0",
        userId: "hidden",
        departmentId: "d1",
        relations: { users: [] },
      },
    ]);
  });
});
