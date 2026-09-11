import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Query } from "../src/Query";
import { QueryEvaluation } from "../src/QueryEvaluation";

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  age: z.number(),
  active: z.boolean(),
});

const ReservationSchema = z.object({
  id: z.string(),
  userId: z.string(),
  staffId: z.string(),
});

const StaffSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const tables = [
  {
    name: "users",
    schema: UserSchema,
  },
  {
    name: "reservations",
    schema: ReservationSchema,
  },
  {
    name: "staffs",
    schema: StaffSchema,
  },
] as const;

describe("QueryEvaluation", () => {
  it("条件なしなら全Recordを返す", () => {
    const query = new Query<typeof tables, "users">("users");

    const evaluation = new QueryEvaluation(query, vi.fn());

    const records = [
      { id: "1", name: "A", age: 10, active: true },
      { id: "2", name: "B", age: 20, active: false },
    ];

    expect(evaluation.apply(records)).toEqual(records);
  });

  it("and条件を適用する", () => {
    const query = new Query<typeof tables, "users">("users").and(
      "active",
      "=",
      [true],
    );

    const evaluation = new QueryEvaluation(query, vi.fn());

    const records = [
      { id: "1", name: "A", age: 10, active: true },
      { id: "2", name: "B", age: 20, active: false },
    ];

    expect(evaluation.apply(records)).toEqual([
      { id: "1", name: "A", age: 10, active: true },
    ]);
  });

  it("複数and条件をすべて適用する", () => {
    const query = new Query<typeof tables, "users">("users")
      .and("active", "=", [true])
      .and("age", ">=", [20]);

    const evaluation = new QueryEvaluation(query, vi.fn());

    const records = [
      { id: "1", name: "A", age: 10, active: true },
      { id: "2", name: "B", age: 20, active: true },
      { id: "3", name: "C", age: 30, active: false },
    ];

    expect(evaluation.apply(records)).toEqual([
      { id: "2", name: "B", age: 20, active: true },
    ]);
  });

  it("or条件のいずれかを満たせば返す", () => {
    const query = new Query<typeof tables, "users">("users")
      .or("name", "=", ["A"])
      .or("name", "=", ["C"]);

    const evaluation = new QueryEvaluation(query, vi.fn());

    const records = [
      { id: "1", name: "A", age: 10, active: true },
      { id: "2", name: "B", age: 20, active: true },
      { id: "3", name: "C", age: 30, active: true },
    ];

    expect(evaluation.apply(records).map((record) => record.id)).toEqual([
      "1",
      "3",
    ]);
  });

  it("filter -> sort -> offset -> limitの順で適用する", () => {
    const query = new Query<typeof tables, "users">("users")
      .and("active", "=", [true])
      .orderBy("age", "asc")
      .offset(1)
      .limit(1);

    const evaluation = new QueryEvaluation(query, vi.fn());

    const records = [
      { id: "1", name: "A", age: 30, active: true },
      { id: "2", name: "B", age: 10, active: false },
      { id: "3", name: "C", age: 20, active: true },
      { id: "4", name: "D", age: 10, active: true },
    ];

    expect(evaluation.apply(records)).toEqual([
      { id: "3", name: "C", age: 20, active: true },
    ]);
  });

  it("同期Loaderでresolveする", () => {
    const query = new Query<typeof tables, "users">("users").and(
      "active",
      "=",
      [true],
    );

    const load = vi.fn((table: string) => {
      if (table === "users") {
        return [
          { id: "1", name: "A", age: 10, active: true },
          { id: "2", name: "B", age: 20, active: false },
        ];
      }

      return [];
    });

    const joinResolver = vi.fn();
    const evaluation = new QueryEvaluation(query, joinResolver);

    expect(evaluation.resolve(load)).toEqual([
      { id: "1", name: "A", age: 10, active: true },
    ]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith("users");
    expect(joinResolver).not.toHaveBeenCalled();
  });

  it("同期Loaderで1階層JOINをresolveする", () => {
    const query = new Query<typeof tables, "users">("users").join(
      "id",
      "reservations",
      "userId",
    );

    const load = vi.fn((table: string) => {
      switch (table) {
        case "users":
          return [
            { id: "u1", name: "A", age: 20, active: true },
            { id: "u2", name: "B", age: 30, active: true },
          ];

        case "reservations":
          return [
            { id: "r1", userId: "u1", staffId: "s1" },
            { id: "r2", userId: "u1", staffId: "s2" },
            { id: "r3", userId: "u2", staffId: "s1" },
          ];

        default:
          return [];
      }
    });

    const joinResolver = vi.fn(({ parent, table, children }) => ({
      parent,
      table,
      children,
    }));

    const evaluation = new QueryEvaluation(query, joinResolver);

    expect(evaluation.resolve(load)).toEqual([
      {
        parent: {
          id: "u1",
          name: "A",
          age: 20,
          active: true,
        },
        table: "reservations",
        children: [
          { id: "r1", userId: "u1", staffId: "s1" },
          { id: "r2", userId: "u1", staffId: "s2" },
        ],
      },
      {
        parent: {
          id: "u2",
          name: "B",
          age: 30,
          active: true,
        },
        table: "reservations",
        children: [{ id: "r3", userId: "u2", staffId: "s1" }],
      },
    ]);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("同期Loaderで子Queryを適用してからJOINする", () => {
    const reservations = new Query<typeof tables, "reservations">(
      "reservations",
    ).and("staffId", "=", ["s1"]);

    const users = new Query<typeof tables, "users">("users").join(
      "id",
      "reservations",
      "userId",
      reservations,
    );

    const load = vi.fn((table: string) => {
      switch (table) {
        case "users":
          return [{ id: "u1", name: "A", age: 20, active: true }];

        case "reservations":
          return [
            { id: "r1", userId: "u1", staffId: "s1" },
            { id: "r2", userId: "u1", staffId: "s2" },
          ];

        default:
          return [];
      }
    });

    const joinResolver = vi.fn(({ parent, table, children }) => ({
      ...parent,
      [table]: children,
    }));

    const evaluation = new QueryEvaluation(users, joinResolver);

    expect(evaluation.resolve(load)).toEqual([
      {
        id: "u1",
        name: "A",
        age: 20,
        active: true,
        reservations: [{ id: "r1", userId: "u1", staffId: "s1" }],
      },
    ]);
  });

  it("同期LoaderでNested JOINをbottom-upにresolveする", () => {
    const staffs = new Query<typeof tables, "staffs">("staffs");

    const reservations = new Query<typeof tables, "reservations">(
      "reservations",
    ).join("staffId", "staffs", "id", staffs);

    const users = new Query<typeof tables, "users">("users").join(
      "id",
      "reservations",
      "userId",
      reservations,
    );

    const load = vi.fn((table: string) => {
      switch (table) {
        case "users":
          return [
            {
              id: "u1",
              name: "Taro",
              age: 20,
              active: true,
            },
          ];

        case "reservations":
          return [
            {
              id: "r1",
              userId: "u1",
              staffId: "s1",
            },
          ];

        case "staffs":
          return [
            {
              id: "s1",
              name: "Hanako",
            },
          ];

        default:
          return [];
      }
    });

    const joinResolver = vi.fn(({ parent, table, children }) => ({
      ...parent,
      [table]: children,
    }));

    const evaluation = new QueryEvaluation(users, joinResolver);

    expect(evaluation.resolve(load)).toEqual([
      {
        id: "u1",
        name: "Taro",
        age: 20,
        active: true,
        reservations: [
          {
            id: "r1",
            userId: "u1",
            staffId: "s1",
            staffs: [
              {
                id: "s1",
                name: "Hanako",
              },
            ],
          },
        ],
      },
    ]);

    expect(load).toHaveBeenNthCalledWith(1, "users");
    expect(load).toHaveBeenNthCalledWith(2, "reservations");
    expect(load).toHaveBeenNthCalledWith(3, "staffs");
  });

  it("非同期LoaderでresolveAsyncする", async () => {
    const query = new Query<typeof tables, "users">("users").and(
      "active",
      "=",
      [true],
    );

    const load = vi.fn(async (table: string) => {
      if (table === "users") {
        return [
          { id: "1", name: "A", age: 10, active: true },
          { id: "2", name: "B", age: 20, active: false },
        ];
      }

      return [];
    });

    const joinResolver = vi.fn();
    const evaluation = new QueryEvaluation(query, joinResolver);

    await expect(evaluation.resolveAsync(load)).resolves.toEqual([
      { id: "1", name: "A", age: 10, active: true },
    ]);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("非同期LoaderでNested JOINをbottom-upにresolveする", async () => {
    const staffs = new Query<typeof tables, "staffs">("staffs");

    const reservations = new Query<typeof tables, "reservations">(
      "reservations",
    ).join("staffId", "staffs", "id", staffs);

    const users = new Query<typeof tables, "users">("users").join(
      "id",
      "reservations",
      "userId",
      reservations,
    );

    const load = vi.fn(async (table: string) => {
      switch (table) {
        case "users":
          return [
            {
              id: "u1",
              name: "Taro",
              age: 20,
              active: true,
            },
          ];

        case "reservations":
          return [
            {
              id: "r1",
              userId: "u1",
              staffId: "s1",
            },
          ];

        case "staffs":
          return [
            {
              id: "s1",
              name: "Hanako",
            },
          ];

        default:
          return [];
      }
    });

    const joinResolver = vi.fn(({ parent, table, children }) => ({
      ...parent,
      [table]: children,
    }));

    const evaluation = new QueryEvaluation(users, joinResolver);

    await expect(evaluation.resolveAsync(load)).resolves.toEqual([
      {
        id: "u1",
        name: "Taro",
        age: 20,
        active: true,
        reservations: [
          {
            id: "r1",
            userId: "u1",
            staffId: "s1",
            staffs: [
              {
                id: "s1",
                name: "Hanako",
              },
            ],
          },
        ],
      },
    ]);

    expect(load).toHaveBeenNthCalledWith(1, "users");
    expect(load).toHaveBeenNthCalledWith(2, "reservations");
    expect(load).toHaveBeenNthCalledWith(3, "staffs");
  });

  it("複数JOINを定義順にresolveする", () => {
    const query = new Query<typeof tables, "users">("users")
      .join("id", "reservations", "userId")
      .join("id", "staffs", "id");

    const load = vi.fn((table: string) => {
      switch (table) {
        case "users":
          return [{ id: "u1", name: "A", age: 20, active: true }];

        case "reservations":
          return [{ id: "r1", userId: "u1", staffId: "s1" }];

        case "staffs":
          return [];

        default:
          return [];
      }
    });

    const joinResolver = vi.fn(({ parent, table, children }) => ({
      ...parent,
      [table]: children,
    }));

    const evaluation = new QueryEvaluation(query, joinResolver);

    expect(evaluation.resolve(load)).toEqual([
      {
        id: "u1",
        name: "A",
        age: 20,
        active: true,
        reservations: [{ id: "r1", userId: "u1", staffId: "s1" }],
        staffs: [],
      },
    ]);

    expect(joinResolver).toHaveBeenCalledTimes(2);
  });

  it("一致するJOIN先がなくてもchildren空配列でresolverを呼ぶ", () => {
    const query = new Query<typeof tables, "users">("users").join(
      "id",
      "reservations",
      "userId",
    );

    const load = vi.fn((table: string) => {
      if (table === "users") {
        return [{ id: "u1", name: "A", age: 20, active: true }];
      }

      return [];
    });

    const joinResolver = vi.fn(({ parent }) => parent);
    const evaluation = new QueryEvaluation(query, joinResolver);

    evaluation.resolve(load);

    expect(joinResolver).toHaveBeenCalledWith({
      parent: {
        id: "u1",
        name: "A",
        age: 20,
        active: true,
      },
      table: "reservations",
      children: [],
    });
  });
});
