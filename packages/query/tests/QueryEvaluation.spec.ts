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

    const evaluation = new QueryEvaluation(query, vi.fn(), vi.fn());

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

    const evaluation = new QueryEvaluation(query, vi.fn(), vi.fn());

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

    const evaluation = new QueryEvaluation(query, vi.fn(), vi.fn());

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

    const evaluation = new QueryEvaluation(query, vi.fn(), vi.fn());

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

  it("orderByを適用する", () => {
    const query = new Query<typeof tables, "users">("users").orderBy(
      "age",
      "asc",
    );

    const evaluation = new QueryEvaluation(query, vi.fn(), vi.fn());

    const records = [
      { id: "3", name: "C", age: 30, active: true },
      { id: "1", name: "A", age: 10, active: true },
      { id: "2", name: "B", age: 20, active: true },
    ];

    expect(evaluation.apply(records).map((record) => record.age)).toEqual([
      10, 20, 30,
    ]);
  });

  it("offsetを適用する", () => {
    const query = new Query<typeof tables, "users">("users").offset(1);

    const evaluation = new QueryEvaluation(query, vi.fn(), vi.fn());

    expect(evaluation.apply([{ id: "1" }, { id: "2" }, { id: "3" }])).toEqual([
      { id: "2" },
      { id: "3" },
    ]);
  });

  it("limitを適用する", () => {
    const query = new Query<typeof tables, "users">("users").limit(2);

    const evaluation = new QueryEvaluation(query, vi.fn(), vi.fn());

    expect(evaluation.apply([{ id: "1" }, { id: "2" }, { id: "3" }])).toEqual([
      { id: "1" },
      { id: "2" },
    ]);
  });

  it("filter -> sort -> offset -> limitの順で適用する", () => {
    const query = new Query<typeof tables, "users">("users")
      .and("active", "=", [true])
      .orderBy("age", "asc")
      .offset(1)
      .limit(1);

    const evaluation = new QueryEvaluation(query, vi.fn(), vi.fn());

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

  it("JOINなしのresolveでは自身のtableだけをloadする", async () => {
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

    const evaluation = new QueryEvaluation(query, load, joinResolver);

    await expect(evaluation.resolve()).resolves.toEqual([
      { id: "1", name: "A", age: 10, active: true },
    ]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith("users");
    expect(joinResolver).not.toHaveBeenCalled();
  });

  it("1階層JOINをresolveする", async () => {
    const query = new Query<typeof tables, "users">("users").join(
      "id",
      "reservations",
      "userId",
    );

    const load = vi.fn(async (table: string) => {
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

    const evaluation = new QueryEvaluation(query, load, joinResolver);

    const result = await evaluation.resolve();

    expect(result).toEqual([
      {
        parent: {
          id: "u1",
          name: "A",
          age: 20,
          active: true,
        },
        table: "reservations",
        children: [
          {
            id: "r1",
            userId: "u1",
            staffId: "s1",
          },
          {
            id: "r2",
            userId: "u1",
            staffId: "s2",
          },
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
        children: [
          {
            id: "r3",
            userId: "u2",
            staffId: "s1",
          },
        ],
      },
    ]);

    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledWith("users");
    expect(load).toHaveBeenCalledWith("reservations");

    expect(joinResolver).toHaveBeenCalledTimes(2);

    expect(joinResolver).toHaveBeenNthCalledWith(1, {
      parent: {
        id: "u1",
        name: "A",
        age: 20,
        active: true,
      },
      table: "reservations",
      children: [
        {
          id: "r1",
          userId: "u1",
          staffId: "s1",
        },
        {
          id: "r2",
          userId: "u1",
          staffId: "s2",
        },
      ],
    });
  });

  it("子Queryを適用してからJOINする", async () => {
    const reservations = new Query<typeof tables, "reservations">(
      "reservations",
    ).and("staffId", "=", ["s1"]);

    const query = new Query<typeof tables, "users">("users").join(
      "id",
      "reservations",
      "userId",
      reservations,
    );

    const load = vi.fn(async (table: string) => {
      if (table === "users") {
        return [
          {
            id: "u1",
            name: "A",
            age: 20,
            active: true,
          },
        ];
      }

      if (table === "reservations") {
        return [
          {
            id: "r1",
            userId: "u1",
            staffId: "s1",
          },
          {
            id: "r2",
            userId: "u1",
            staffId: "s2",
          },
        ];
      }

      return [];
    });

    const joinResolver = vi.fn(({ parent, table, children }) => ({
      parent,
      table,
      children,
    }));

    const evaluation = new QueryEvaluation(query, load, joinResolver);

    const result = await evaluation.resolve();

    expect(result).toEqual([
      {
        parent: {
          id: "u1",
          name: "A",
          age: 20,
          active: true,
        },
        table: "reservations",
        children: [
          {
            id: "r1",
            userId: "u1",
            staffId: "s1",
          },
        ],
      },
    ]);

    expect(joinResolver).toHaveBeenCalledTimes(1);

    expect(joinResolver).toHaveBeenCalledWith({
      parent: {
        id: "u1",
        name: "A",
        age: 20,
        active: true,
      },
      table: "reservations",
      children: [
        {
          id: "r1",
          userId: "u1",
          staffId: "s1",
        },
      ],
    });
  });

  it("JOINを再帰的にbottom-upでresolveする", async () => {
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

    const joinedReservation = {
      id: "r1",
      userId: "u1",
      staffId: "s1",
      resolved: "staffs",
    };

    const joinedUser = {
      id: "u1",
      name: "Taro",
      age: 20,
      active: true,
      resolved: "reservations",
    };

    const joinResolver = vi
      .fn()
      .mockImplementationOnce(({ parent }) => ({
        ...parent,
        resolved: "staffs",
      }))
      .mockImplementationOnce(({ parent }) => ({
        ...parent,
        resolved: "reservations",
      }));

    const evaluation = new QueryEvaluation(users, load, joinResolver);

    const result = await evaluation.resolve();

    expect(result).toEqual([joinedUser]);

    expect(joinResolver).toHaveBeenCalledTimes(2);

    expect(joinResolver).toHaveBeenNthCalledWith(1, {
      parent: {
        id: "r1",
        userId: "u1",
        staffId: "s1",
      },
      table: "staffs",
      children: [
        {
          id: "s1",
          name: "Hanako",
        },
      ],
    });

    expect(joinResolver).toHaveBeenNthCalledWith(2, {
      parent: {
        id: "u1",
        name: "Taro",
        age: 20,
        active: true,
      },
      table: "reservations",
      children: [joinedReservation],
    });

    expect(load).toHaveBeenCalledTimes(3);
    expect(load).toHaveBeenNthCalledWith(1, "users");
    expect(load).toHaveBeenNthCalledWith(2, "reservations");
    expect(load).toHaveBeenNthCalledWith(3, "staffs");
  });

  it("複数JOINを定義順にresolveする", async () => {
    const query = new Query<typeof tables, "users">("users")
      .join("id", "reservations", "userId")
      .join("id", "reservations", "userId");

    const load = vi.fn(async (table: string) => {
      if (table === "users") {
        return [
          {
            id: "u1",
            name: "A",
            age: 20,
            active: true,
          },
        ];
      }

      if (table === "reservations") {
        return [
          {
            id: "r1",
            userId: "u1",
            staffId: "s1",
          },
        ];
      }

      return [];
    });

    const firstResolved = {
      id: "u1",
      step: 1,
    };

    const secondResolved = {
      id: "u1",
      step: 2,
    };

    const joinResolver = vi
      .fn()
      .mockReturnValueOnce(firstResolved)
      .mockReturnValueOnce(secondResolved);

    const evaluation = new QueryEvaluation(query, load, joinResolver);

    await expect(evaluation.resolve()).resolves.toEqual([secondResolved]);

    expect(joinResolver).toHaveBeenNthCalledWith(1, {
      parent: {
        id: "u1",
        name: "A",
        age: 20,
        active: true,
      },
      table: "reservations",
      children: [
        {
          id: "r1",
          userId: "u1",
          staffId: "s1",
        },
      ],
    });

    expect(joinResolver).toHaveBeenNthCalledWith(2, {
      parent: firstResolved,
      table: "reservations",
      children: [
        {
          id: "r1",
          userId: "u1",
          staffId: "s1",
        },
      ],
    });
  });

  it("JOIN対象が存在しない場合も空配列をresolverへ渡す", async () => {
    const query = new Query<typeof tables, "users">("users").join(
      "id",
      "reservations",
      "userId",
    );

    const load = vi.fn(async (table: string) => {
      if (table === "users") {
        return [
          {
            id: "u1",
            name: "A",
            age: 20,
            active: true,
          },
        ];
      }

      return [];
    });

    const resolved = {
      id: "u1",
      resolved: true,
    };

    const joinResolver = vi.fn(() => resolved);

    const evaluation = new QueryEvaluation(query, load, joinResolver);

    await expect(evaluation.resolve()).resolves.toEqual([resolved]);

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
