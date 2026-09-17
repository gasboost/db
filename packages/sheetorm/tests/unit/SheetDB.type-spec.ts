import { InMemoryCacheService } from "@gasboost/fake-core";
import { NodeUtilities } from "@gasboost/fake-node";
import { RowLevelSecurity, allow } from "@gasboost/rls";
import { it } from "vitest";
import { z } from "zod";
import { SheetDB } from "../../src/core/SheetDB";
import { SheetTable } from "../../src/core/SheetTable";
import { InMemoryGateway } from "../../src/gateway/InMemoryGateway";
import { InMemoryDataStore } from "../../src/storage/InMemoryDataStore";

it("rejects RLS for a table outside SheetDB tables", () => {
  const userSchema = z.object({
    id: z.number(),
  });

  const orderSchema = z.object({
    id: z.number(),
  });

  const users = new SheetTable({
    dbId: "db",
    name: "users",
    schema: userSchema,
    primaryKey: "id",
  });

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

  new SheetDB({
    tables: [users] as const,
    gateway: new InMemoryGateway(
      new InMemoryDataStore(new Map([["db:users", [["id"]]]])),
    ),
    cacheService: new InMemoryCacheService(),
    utilities: new NodeUtilities(),

    // @ts-expect-error RLS table must belong to SheetDB tables
    rowLevelSecurity: [ordersRls],
  });
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
