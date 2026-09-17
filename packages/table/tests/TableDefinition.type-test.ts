import { z } from "zod";
import {
  defineTable,
  type PrimaryKey,
  type TableByName,
  type TableName,
  type TableRecord,
} from "../src";

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
});

const users = defineTable({
  name: "users",
  schema: userSchema,
  primaryKey: "id",
});

const unkeyedUsers = defineTable({
  name: "users",
  schema: userSchema,
});

defineTable({
  name: "invalid",
  schema: userSchema,
  // @ts-expect-error primaryKey must exist in schema
  primaryKey: "missing",
});

type UserName = TableName<typeof users>;
const userName: UserName = "users";

type UserPrimaryKey = PrimaryKey<typeof users>;
const userPrimaryKey: UserPrimaryKey = "id";

type UserRecord = TableRecord<typeof users>;
const user: UserRecord = {
  id: "user-1",
  name: "Tiger",
  active: true,
};

const tables = [users, unkeyedUsers] as const;
type UsersByName = TableByName<typeof tables, "users">;
const tableByName: UsersByName = users;

// @ts-expect-error literal table name is preserved
const invalidName: UserName = "orders";

// @ts-expect-error literal primaryKey is preserved
const invalidPrimaryKey: UserPrimaryKey = "name";

void userName;
void userPrimaryKey;
void user;
void tableByName;
void invalidName;
void invalidPrimaryKey;
