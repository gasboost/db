import { and, column, eq, principal, RowLevelSecurity } from "@gasboost/rls";
import { z } from "zod";
import { FirebaseRtdb } from "../src";

const principalSchema = z.object({
  userId: z.string(),
  storeId: z.string(),
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

FirebaseRtdb.generate({
  tables: [users] as const,
  rowLevelSecurity: [security],
  // @ts-expect-error userId is required because RLS references principal.userId
  principal: {
    storeId: "auth.token.storeId",
  },
});

FirebaseRtdb.generate({
  tables: [users] as const,
  rowLevelSecurity: [security],
  principal: {
    userId: "auth.uid",
    storeId: "auth.token.storeId",
  },
});

const multiplePrincipalSecurity = new RowLevelSecurity({
  table: users,
  select: {
    using: and(
      eq(column(users, "id"), principal(principalSchema, "userId")),
      eq(column(users, "name"), principal(principalSchema, "storeId")),
    ),
  },
});

FirebaseRtdb.generate({
  tables: [users] as const,
  rowLevelSecurity: [multiplePrincipalSecurity],
  principal: {
    userId: "auth.uid",
    storeId: "auth.token.storeId",
  },
});

FirebaseRtdb.generate({
  tables: [users] as const,
  rowLevelSecurity: [multiplePrincipalSecurity],
  // @ts-expect-error storeId is also required by RLS
  principal: {
    userId: "auth.uid",
  },
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
