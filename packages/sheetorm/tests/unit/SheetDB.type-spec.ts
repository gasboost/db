import { InMemoryCacheService } from "@gasboost/fake-core";
import { NodeUtilities } from "@gasboost/fake-node";
import { RowLevelSecurity, allow } from "@gasboost/rls";
import { defineTable } from "@gasboost/table";
import { it } from "vitest";
import { z } from "zod";
import { SheetDB } from "../../src/core/SheetDB";
import { SheetTable } from "../../src/core/SheetTable";
import { InMemoryGateway } from "../../src/gateway/InMemoryGateway";
import { InMemoryDataStore } from "../../src/storage/InMemoryDataStore";

it("accepts logical and SheetTable RLS only for registered table names", () => {
  const userSchema = z.object({
    id: z.number(),
  });

  const orderSchema = z.object({
    id: z.number(),
  });

  const userDefinition = defineTable({
    name: "users",
    schema: userSchema,
    primaryKey: "id",
  });

  const users = new SheetTable({ ...userDefinition, dbId: "db" });

  const orders = new SheetTable({
    dbId: "db",
    name: "orders",
    schema: orderSchema,
    primaryKey: "id",
  });

  const ordersRls = new RowLevelSecurity({
    table: orders,
    select: {
      using: allow(),
    },
  });

  const usersRls = new RowLevelSecurity({
    table: userDefinition,
    select: {
      using: allow(),
    },
  });

  const sheetUsersRls = new RowLevelSecurity({
    table: users,
    select: {
      using: allow(),
    },
  });

  const config = {
    tables: [users] as const,
    gateway: new InMemoryGateway(
      new InMemoryDataStore(new Map([["db:users", [["id"]]]])),
    ),
    cacheService: new InMemoryCacheService(),
    utilities: new NodeUtilities(),

    rowLevelSecurity: [usersRls, sheetUsersRls] as const,
  };

  const db = new SheetDB(config);

  new SheetDB({
    ...config,
    // @ts-expect-error RLS table must belong to SheetDB tables
    rowLevelSecurity: [ordersRls],
  });

  const policies: typeof db.rowLevelSecurity = [usersRls, sheetUsersRls] as const;
  // @ts-expect-error public RLS property must retain registered table names
  const invalidPolicies: typeof db.rowLevelSecurity = [ordersRls];
  void policies;
  void invalidPolicies;
});

const users = new SheetTable({
  dbId: "db",
  name: "users",
  schema: z.object({
    id: z.string(),
    name: z.string(),
  }),
  primaryKey: "id",
});

const posts = new SheetTable({
  dbId: "db",
  name: "posts",
  schema: z.object({
    id: z.string(),
    userId: z.string(),
    title: z.string(),
  }),
  primaryKey: "id",
});

const comments = new SheetTable({
  dbId: "db",
  name: "comments",
  schema: z.object({
    id: z.string(),
    postId: z.string(),
    body: z.string(),
  }),
  primaryKey: "id",
});

const profiles = new SheetTable({
  dbId: "db",
  name: "profiles",
  schema: z.object({
    id: z.string(),
    userId: z.string(),
    bio: z.string(),
  }),
  primaryKey: "id",
});

const tables = [users, posts, comments, profiles] as const;

declare const db: SheetDB<typeof tables>;

const userDefinition = db.definition("users");
const userDefinitionName: "users" = userDefinition.name;
const userDefinitionNameField = userDefinition.schema.shape.name;

// @ts-expect-error users table does not have title column
userDefinition.schema.shape.title;

const postDefinition = db.definition("posts");
const postDefinitionName: "posts" = postDefinition.name;
const postDefinitionTitleField = postDefinition.schema.shape.title;

// @ts-expect-error unknown table names are rejected
db.definition("unknown");

const noJoin = db.find(db.query("users"));

const noJoinId: string = noJoin[0].id;
const noJoinName: string = noJoin[0].name;

// @ts-expect-error JOIN なしでは relations は存在しない
noJoin[0].relations;

const oneJoin = db.find(db.query("users").join("id", "posts", "userId"));

const postId: string = oneJoin[0].relations.posts[0].id;
const postTitle: string = oneJoin[0].relations.posts[0].title;

// @ts-expect-error posts に存在しない column
oneJoin[0].relations.posts[0].body;

const multipleJoin = db.find(
  db
    .query("users")
    .join("id", "posts", "userId")
    .join("id", "profiles", "userId"),
);

const multiplePostTitle: string = multipleJoin[0].relations.posts[0].title;

const profileBio: string = multipleJoin[0].relations.profiles[0].bio;

const postsQuery = db.query("posts").join("id", "comments", "postId");

const nestedJoin = db.find(
  db.query("users").join("id", "posts", "userId", postsQuery),
);

const nestedPostTitle: string = nestedJoin[0].relations.posts[0].title;

const nestedCommentBody: string =
  nestedJoin[0].relations.posts[0].relations.comments[0].body;

void noJoinId;
void noJoinName;
void userDefinitionName;
void userDefinitionNameField;
void postDefinitionName;
void postDefinitionTitleField;
void postId;
void postTitle;
void multiplePostTitle;
void profileBio;
void nestedPostTitle;
void nestedCommentBody;

const many = db.findMany(["users", "posts"] as const);
const manyUserName: string = many.users[0].name;
const manyPostTitle: string = many.posts[0].title;
// @ts-expect-error only requested tables appear in the result
many.comments;
// @ts-expect-error users records do not have post fields
many.users[0].title;
// @ts-expect-error record fields retain their schema type
const manyWrongId: number = many.posts[0].id;
// @ts-expect-error unknown tables are rejected
db.findMany(["users", "unknown"]);

const inferredMany = db.findMany(["users", "profiles"]);
const inferredBio: string = inferredMany.profiles[0].bio;
// @ts-expect-error literal input is inferred without as const
inferredMany.posts;
const emptyMany = db.findMany([]);
// @ts-expect-error empty input has no table keys
emptyMany.users;
void manyUserName;
void manyPostTitle;
void inferredBio;

const objectJoin = db.find(
  db
    .query("users")
    .join({
      table: "posts",
      on: { local: "id", reference: "userId" },
      query: postsQuery,
      type: "inner",
    })
    .join({
      table: "profiles",
      on: { local: "id", reference: "userId" },
      type: "left",
    })
    .orderBy("name")
    .offset(1)
    .limit(20),
);
const objectCommentBody: string =
  objectJoin[0].relations.posts[0].relations.comments[0].body;
const objectProfileBio: string = objectJoin[0].relations.profiles[0].bio;
// @ts-expect-error joined fields preserve schema types
const wrongObjectBody: number =
  objectJoin[0].relations.posts[0].relations.comments[0].body;
db.query("users").join({
  table: "profiles",
  on: { local: "id", reference: "userId" },
  // @ts-expect-error the subquery must target the selected table
  query: postsQuery,
});
void objectCommentBody;
void objectProfileBio;
