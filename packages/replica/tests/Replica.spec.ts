import { Query } from "@gasboost/query";
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createReplica } from "../src/createReplica";

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
});

const ReservationSchema = z.object({
  id: z.string(),
  userId: z.string(),
});

const tables = [
  {
    name: "users",
    schema: UserSchema,
    primaryKey: "id",
  },
  {
    name: "reservations",
    schema: ReservationSchema,
    primaryKey: "id",
  },
] as const;

describe("Replica", () => {
  it("putしたRecordを取得できる", async () => {
    const replica = createReplica({
      name: "put-test",
      tables,
    });

    await replica.table("users").put({
      id: "u1",
      name: "Alice",
      active: true,
    });

    expect(await replica.table("users").toArray()).toEqual([
      {
        id: "u1",
        name: "Alice",
        active: true,
      },
    ]);
  });

  it("bulkPutできる", async () => {
    const replica = createReplica({
      name: "bulk-put-test",
      tables,
    });

    await replica.table("users").bulkPut([
      {
        id: "u1",
        name: "Alice",
        active: true,
      },
      {
        id: "u2",
        name: "Bob",
        active: false,
      },
    ]);

    expect(await replica.table("users").toArray()).toHaveLength(2);
  });

  it("deleteできる", async () => {
    const replica = createReplica({
      name: "delete-test",
      tables,
    });

    await replica.table("users").put({
      id: "u1",
      name: "Alice",
      active: true,
    });

    await replica.table("users").delete("u1");

    expect(await replica.table("users").toArray()).toEqual([]);
  });

  it("完全同期できる", async () => {
    const replica = createReplica({
      name: "sync-test",
      tables,
    });

    await replica.table("users").bulkPut([
      {
        id: "u1",
        name: "old",
        active: true,
      },
      {
        id: "deleted",
        name: "deleted",
        active: false,
      },
    ]);

    await replica.sync("users", [
      {
        id: "u1",
        name: "new",
        active: true,
      },
      {
        id: "u2",
        name: "Bob",
        active: false,
      },
    ]);

    expect(await replica.table("users").toArray()).toEqual([
      {
        id: "u1",
        name: "new",
        active: true,
      },
      {
        id: "u2",
        name: "Bob",
        active: false,
      },
    ]);
  });

  it("Queryを実行できる", async () => {
    const replica = createReplica({
      name: "query-test",
      tables,
    });

    await replica.table("users").bulkPut([
      {
        id: "u1",
        name: "Alice",
        active: true,
      },
      {
        id: "u2",
        name: "Bob",
        active: false,
      },
    ]);

    const query = new Query<typeof tables, "users">({
      tableName: "users",
    }).and("active", "=", [true]);

    expect(await replica.find(query)).toEqual([
      {
        id: "u1",
        name: "Alice",
        active: true,
      },
    ]);
  });

  it("JOINできる", async () => {
    const replica = createReplica({
      name: "join-test",
      tables,
    });

    await replica.table("users").put({
      id: "u1",
      name: "Alice",
      active: true,
    });

    await replica.table("reservations").put({
      id: "r1",
      userId: "u1",
    });

    const query = new Query<typeof tables, "users">({
      tableName: "users",
    }).join("id", "reservations", "userId");

    expect(await replica.find(query)).toEqual([
      {
        id: "u1",
        name: "Alice",
        active: true,
        reservations: [
          {
            id: "r1",
            userId: "u1",
          },
        ],
      },
    ]);
  });

  it("Nested JOINできる", async () => {
    const StaffSchema = z.object({
      id: z.string(),
      name: z.string(),
    });

    const nestedTables = [
      {
        name: "users",
        schema: UserSchema,
        primaryKey: "id",
      },
      {
        name: "reservations",
        schema: ReservationSchema.extend({
          staffId: z.string(),
        }),
        primaryKey: "id",
      },
      {
        name: "staffs",
        schema: StaffSchema,
        primaryKey: "id",
      },
    ] as const;

    const replica = createReplica({
      name: "nested-join-test",
      tables: nestedTables,
    });

    await replica.table("users").put({
      id: "u1",
      name: "Alice",
      active: true,
    });

    await replica.table("reservations").put({
      id: "r1",
      userId: "u1",
      staffId: "s1",
    });

    await replica.table("staffs").put({
      id: "s1",
      name: "Hanako",
    });

    const reservations = new Query<typeof nestedTables, "reservations">({
      tableName: "reservations",
    }).join("staffId", "staffs", "id");

    const users = new Query<typeof nestedTables, "users">({
      tableName: "users",
    }).join("id", "reservations", "userId", reservations);

    expect(await replica.find(users)).toEqual([
      {
        id: "u1",
        name: "Alice",
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
  });

  it("空配列でsyncするとTableが空になる", async () => {
    const replica = createReplica({
      name: "empty-sync-test",
      tables,
    });

    await replica.table("users").put({
      id: "u1",
      name: "Alice",
      active: true,
    });

    await replica.sync("users", []);

    expect(await replica.table("users").toArray()).toEqual([]);
  });
});
