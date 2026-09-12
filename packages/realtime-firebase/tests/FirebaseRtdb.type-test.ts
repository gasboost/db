import { column, eq, principal, RowLevelSecurity } from "@gasboost/rls";
import { z } from "zod";
import { FirebaseRtdb } from "../src";

const principalSchema = z.object({
  userId: z.string(),
});

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const users = {
  name: "users",
  schema: userSchema,
  primaryKey: "id",
} as const;

const security = new RowLevelSecurity({
  table: users,
  select: {
    using: eq(column(users, "id"), principal(principalSchema, "userId")),
  },
});

const rtdb = FirebaseRtdb.generate({
  tables: [users] as const,
  rowLevelSecurity: [security],
  principal: {
    userId: "auth.uid",
  },
});

rtdb.users.record({
  id: "user-1",
  name: "Tiger",
});

rtdb.users.scope({
  userId: "user-1",
});

// @ts-expect-error unknown table
rtdb.orders;

// @ts-expect-error missing record field
rtdb.users.record({
  id: "user-1",
});

rtdb.users.scope({
  userId: "user-1",
  // @ts-expect-error unknown principal field
  storeId: "store-1",
});

const invalidPrimaryKeyUsers = {
  name: "users",
  schema: userSchema,
  primaryKey: "missing",
} as const;

FirebaseRtdb.generate({
  // @ts-expect-error primaryKey must be a key of the table schema
  tables: [invalidPrimaryKeyUsers] as const,
  principal: {
    userId: "auth.uid",
  },
});
