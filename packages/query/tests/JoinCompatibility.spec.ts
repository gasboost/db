import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Query, QueryEvaluation } from "../src";
import type { JoinResolver } from "../src/Join";

const tables = [
  {
    name: "employees",
    schema: z.object({
      id: z.string(),
      userId: z.string(),
      departmentId: z.string(),
      active: z.boolean(),
    }),
  },
  { name: "users", schema: z.object({ id: z.string(), name: z.string() }) },
  {
    name: "departments",
    schema: z.object({ id: z.string(), name: z.string() }),
  },
] as const;

const data = {
  employees: [
    { id: "e4", userId: "u4", departmentId: "d1", active: true },
    { id: "e0", userId: "missing", departmentId: "d1", active: true },
    { id: "e2", userId: "u2", departmentId: "missing", active: true },
    { id: "e1", userId: "u1", departmentId: "d1", active: true },
    { id: "e3", userId: "u3", departmentId: "d1", active: false },
  ],
  users: [
    { id: "u1", name: "佐藤" },
    { id: "u2", name: "田中一郎" },
    { id: "u2", name: "田中次郎" },
    { id: "u3", name: "田中三郎" },
    { id: "u4", name: "田中四郎" },
  ],
  departments: [{ id: "d1", name: "開発" }],
};
const load = (table: (typeof tables)[number]["name"]) => data[table];
const resolver: JoinResolver = ({ parent, table, children }) => ({
  ...parent,
  relations: { ...(parent.relations as object), [table]: children },
});
const employees = () => new Query<typeof tables, "employees">("employees");
const users = () => new Query<typeof tables, "users">("users");

async function evaluate(
  query: Query<typeof tables, any, any>,
  resolve = resolver,
) {
  const evaluation = new QueryEvaluation(query, resolve);
  const sync = evaluation.resolve(load);
  expect(await evaluation.resolveAsync(async (table) => load(table))).toEqual(
    sync,
  );
  return sync;
}

describe("JOIN API and evaluation compatibility", () => {
  it.each([undefined, "left"] as const)(
    "object %s keeps unmatched parents and matches the positional API",
    async (type) => {
      const subquery = users().and("name", "*", ["田中"]);
      const legacy = employees().join("userId", "users", "id", subquery);
      const object = employees().join({
        table: "users",
        on: { local: "userId", reference: "id" },
        query: subquery,
        type,
      });
      const result = await evaluate(object);
      expect(result).toEqual(await evaluate(legacy));
      expect(result).toHaveLength(5);
      expect(result[1].relations).toEqual({ users: [] });
      expect(result[3].relations).toEqual({ users: [] });
      expect(object.joins[0].type).toBe("left");
    },
  );

  it("filters employees by user name without duplicating parents", async () => {
    const result = await evaluate(
      employees().join({
        table: "users",
        on: { local: "userId", reference: "id" },
        query: users().and("name", "*", ["田中"]),
        type: "inner",
      }),
    );
    expect(result.map((record) => record.id)).toEqual(["e4", "e2", "e3"]);
    expect(result[1].relations).toEqual({ users: data.users.slice(1, 3) });
  });

  it.each([false, true])(
    "evaluates mixed joins in declaration order (left first: %s)",
    async (leftFirst) => {
      const query = employees();
      const left = () =>
        query.join({
          table: "departments",
          on: { local: "departmentId", reference: "id" },
          type: "left",
        });
      const inner = () =>
        query.join({
          table: "users",
          on: { local: "userId", reference: "id" },
          type: "inner",
        });
      if (leftFirst) {
        left();
        inner();
      } else {
        inner();
        left();
      }
      const resolve = vi.fn(resolver);
      const result = await evaluate(query, resolve);
      expect(result.map((record) => record.id)).toEqual([
        "e4",
        "e2",
        "e1",
        "e3",
      ]);
      expect(result[1].relations).toEqual({
        departments: [],
        users: data.users.slice(1, 3),
      });
      const calls = resolve.mock.calls.slice(0, leftFirst ? 9 : 8);
      expect(calls.map(([args]) => args.table)).toEqual(
        leftFirst
          ? [...Array(5).fill("departments"), ...Array(4).fill("users")]
          : [...Array(4).fill("users"), ...Array(4).fill("departments")],
      );
    },
  );

  it("filters parents before joining and sorts/pages after INNER JOIN", async () => {
    const resolve = vi.fn(resolver);
    const query = employees()
      .and("active", "=", [true])
      .join({
        table: "users",
        on: { local: "userId", reference: "id" },
        query: users().and("name", "*", ["田中"]),
        type: "inner",
      })
      .orderBy("id")
      .offset(1)
      .limit(1);
    const result = await evaluate(query, resolve);
    expect(result.map((record) => record.id)).toEqual(["e4"]);
    expect(
      resolve.mock.calls.every(([args]) => args.parent.active === true),
    ).toBe(true);
  });

  it("keeps legacy LEFT pagination and resolver order, including subqueries", async () => {
    const subquery = users().orderBy("name").offset(1).limit(2);
    const query = employees()
      .and("active", "=", [true])
      .orderBy("id")
      .offset(1)
      .limit(2)
      .join("userId", "users", "id", subquery);
    const resolve = vi.fn(resolver);
    const result = await evaluate(query, resolve);
    // Reference the previous algorithm: apply parent and child queries, then combine.
    const parents = new QueryEvaluation(query, resolver).apply(data.employees);
    const children = new QueryEvaluation(subquery, resolver).apply(data.users);
    expect(result).toEqual(query.joins[0].combine(parents, children, resolver));
    expect(result.map((record) => record.id)).toEqual(["e1", "e2"]);
    expect(resolve.mock.calls.map(([args]) => args.parent.id)).toEqual([
      "e1",
      "e2",
      "e1",
      "e2",
    ]);
  });

  it.each(["left", "inner"] as const)(
    "evaluates nested INNER independently of the outer %s join",
    async (type) => {
      const subquery = employees()
        .join({
          table: "departments",
          on: { local: "departmentId", reference: "id" },
          type: "inner",
        })
        .orderBy("id")
        .offset(1)
        .limit(1);
      const query = users().join({
        table: "employees",
        on: { local: "id", reference: "userId" },
        query: subquery,
        type,
      });
      const result = await evaluate(query);
      expect(result.map((record) => record.id)).toEqual(
        type === "inner" ? ["u1"] : data.users.map((record) => record.id),
      );
      expect(result[0].relations).toEqual({
        employees: [
          {
            ...data.employees[3],
            relations: { departments: data.departments },
          },
        ],
      });
    },
  );

  it("apply remains filter/sort/offset/limit only, even with INNER", () => {
    const resolve = vi.fn(resolver);
    const query = employees()
      .and("active", "=", [true])
      .orderBy("id")
      .offset(1)
      .limit(1)
      .join({
        table: "users",
        on: { local: "userId", reference: "id" },
        query: users().and("name", "=", ["nobody"]),
        type: "inner",
      });
    expect(new QueryEvaluation(query, resolve).apply(data.employees)).toEqual([
      data.employees[3],
    ]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("INNER returns no parents when the child query has no matches", async () => {
    expect(
      await evaluate(
        employees().join({
          table: "users",
          on: { local: "userId", reference: "id" },
          query: users().and("name", "=", ["nobody"]),
          type: "inner",
        }),
      ),
    ).toEqual([]);
  });
});
