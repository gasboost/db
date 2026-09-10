import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Query } from "../src/Query";

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

describe("Query", () => {
  it("条件なしなら全Recordを返す", () => {
    const query = new Query<typeof tables, "users">({
      tableName: "users",
    });

    const records = [
      { id: "1", name: "A", age: 10, active: true },
      { id: "2", name: "B", age: 20, active: false },
    ];

    expect(query.apply(records)).toEqual(records);
  });

  it("and条件を適用する", () => {
    const query = new Query<typeof tables, "users">({
      tableName: "users",
    }).and("active", "=", [true]);

    const records = [
      { id: "1", name: "A", age: 10, active: true },
      { id: "2", name: "B", age: 20, active: false },
    ];

    expect(query.apply(records)).toEqual([
      { id: "1", name: "A", age: 10, active: true },
    ]);
  });

  it("複数and条件をすべて適用する", () => {
    const query = new Query<typeof tables, "users">({
      tableName: "users",
    })
      .and("active", "=", [true])
      .and("age", ">=", [20]);

    const records = [
      { id: "1", name: "A", age: 10, active: true },
      { id: "2", name: "B", age: 20, active: true },
      { id: "3", name: "C", age: 30, active: false },
    ];

    expect(query.apply(records)).toEqual([
      { id: "2", name: "B", age: 20, active: true },
    ]);
  });

  it("or条件のいずれかを満たせば返す", () => {
    const query = new Query<typeof tables, "users">({
      tableName: "users",
    })
      .or("name", "=", ["A"])
      .or("name", "=", ["C"]);

    const records = [
      { id: "1", name: "A", age: 10, active: true },
      { id: "2", name: "B", age: 20, active: true },
      { id: "3", name: "C", age: 30, active: true },
    ];

    expect(query.apply(records).map((record) => record.id)).toEqual(["1", "3"]);
  });

  it("orderByを適用する", () => {
    const query = new Query<typeof tables, "users">({
      tableName: "users",
    }).orderBy("age", "asc");

    const records = [
      { id: "3", name: "C", age: 30, active: true },
      { id: "1", name: "A", age: 10, active: true },
      { id: "2", name: "B", age: 20, active: true },
    ];

    expect(query.apply(records).map((record) => record.age)).toEqual([
      10, 20, 30,
    ]);
  });

  it("offsetを適用する", () => {
    const query = new Query<typeof tables, "users">({
      tableName: "users",
    }).offset(1);

    expect(query.apply([{ id: "1" }, { id: "2" }, { id: "3" }])).toEqual([
      { id: "2" },
      { id: "3" },
    ]);
  });

  it("limitを適用する", () => {
    const query = new Query<typeof tables, "users">({
      tableName: "users",
    }).limit(2);

    expect(query.apply([{ id: "1" }, { id: "2" }, { id: "3" }])).toEqual([
      { id: "1" },
      { id: "2" },
    ]);
  });

  it("filter -> sort -> offset -> limitの順で適用する", () => {
    const query = new Query<typeof tables, "users">({
      tableName: "users",
    })
      .and("active", "=", [true])
      .orderBy("age", "asc")
      .offset(1)
      .limit(1);

    const records = [
      { id: "1", name: "A", age: 30, active: true },
      { id: "2", name: "B", age: 10, active: false },
      { id: "3", name: "C", age: 20, active: true },
      { id: "4", name: "D", age: 10, active: true },
    ];

    expect(query.apply(records)).toEqual([
      { id: "3", name: "C", age: 20, active: true },
    ]);
  });

  it("JOINなしのresolveでは自身のtableだけをloadする", async () => {
    const query = new Query<typeof tables, "users">({
      tableName: "users",
    }).and("active", "=", [true]);

    const load = vi.fn(async (table: string) => {
      if (table === "users") {
        return [
          { id: "1", name: "A", age: 10, active: true },
          { id: "2", name: "B", age: 20, active: false },
        ];
      }

      return [];
    });

    await expect(query.resolve(load)).resolves.toEqual([
      { id: "1", name: "A", age: 10, active: true },
    ]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith("users");
  });

  it("1階層JOINをresolveする", async () => {
    const query = new Query<typeof tables, "users">({
      tableName: "users",
    }).join("id", "reservations", "userId");

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

    await expect(query.resolve(load)).resolves.toEqual([
      {
        id: "u1",
        name: "A",
        age: 20,
        active: true,
        reservations: [
          { id: "r1", userId: "u1", staffId: "s1" },
          { id: "r2", userId: "u1", staffId: "s2" },
        ],
      },
      {
        id: "u2",
        name: "B",
        age: 30,
        active: true,
        reservations: [{ id: "r3", userId: "u2", staffId: "s1" }],
      },
    ]);
  });

  it("子Queryを適用してからJOINする", async () => {
    const reservations = new Query<typeof tables, "reservations">({
      tableName: "reservations",
    }).and("staffId", "=", ["s1"]);

    const query = new Query<typeof tables, "users">({
      tableName: "users",
    }).join("id", "reservations", "userId", reservations);

    const load = vi.fn(async (table: string) => {
      if (table === "users") {
        return [{ id: "u1", name: "A", age: 20, active: true }];
      }

      if (table === "reservations") {
        return [
          { id: "r1", userId: "u1", staffId: "s1" },
          { id: "r2", userId: "u1", staffId: "s2" },
        ];
      }

      return [];
    });

    await expect(query.resolve(load)).resolves.toEqual([
      {
        id: "u1",
        name: "A",
        age: 20,
        active: true,
        reservations: [{ id: "r1", userId: "u1", staffId: "s1" }],
      },
    ]);
  });

  it("JOINを再帰的にbottom-upでresolveする", async () => {
    const staffs = new Query<typeof tables, "staffs">({
      tableName: "staffs",
    });

    const reservations = new Query<typeof tables, "reservations">({
      tableName: "reservations",
    }).join("staffId", "staffs", "id", staffs);

    const users = new Query<typeof tables, "users">({
      tableName: "users",
    }).join("id", "reservations", "userId", reservations);

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

    await expect(users.resolve(load)).resolves.toEqual([
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

    expect(load).toHaveBeenCalledWith("users");
    expect(load).toHaveBeenCalledWith("reservations");
    expect(load).toHaveBeenCalledWith("staffs");
  });
});
