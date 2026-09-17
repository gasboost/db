import { z } from "zod";
import { createReplica } from "../src";

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
});

const PostSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string(),
});

const CommentSchema = z.object({
  id: z.string(),
  postId: z.string(),
  body: z.string(),
});

const ProfileSchema = z.object({
  id: z.string(),
  userId: z.string(),
  bio: z.string(),
});

const schema = z.object({
  id: z.string(),
  name: z.string(),
});

createReplica({
  name: "valid",
  tables: [
    {
      name: "users",
      schema,
      primaryKey: "id",
    },
  ] as const,
});

const invalidTables = [
  {
    name: "users",
    schema,
    primaryKey: "missing",
  },
] as const;

createReplica({
  name: "invalid",
  // @ts-expect-error primaryKey "missing" does not exist in schema
  tables: invalidTables,
});

const tables = [
  {
    name: "users",
    schema: UserSchema,
    primaryKey: "id",
  },
  {
    name: "posts",
    schema: PostSchema,
    primaryKey: "id",
  },
  {
    name: "comments",
    schema: CommentSchema,
    primaryKey: "id",
  },
  {
    name: "profiles",
    schema: ProfileSchema,
    primaryKey: "id",
  },
] as const;

const replica = createReplica({
  name: "query-result-types",
  tables,
});

async function verifyNoJoin() {
  const users = await replica.find(replica.query("users"));

  const id: string = users[0].id;
  const name: string = users[0].name;
  const active: boolean = users[0].active;

  // @ts-expect-error JOIN なしでは relations は存在しない
  users[0].relations;

  void id;
  void name;
  void active;
}

async function verifyOneJoin() {
  const users = await replica.find(
    replica.query("users").join("id", "posts", "userId"),
  );

  const id: string = users[0].id;
  const postId: string = users[0].relations.posts[0].id;
  const postTitle: string = users[0].relations.posts[0].title;

  // @ts-expect-error posts に存在しない column
  users[0].relations.posts[0].body;

  void id;
  void postId;
  void postTitle;
}

async function verifyMultipleJoin() {
  const users = await replica.find(
    replica
      .query("users")
      .join("id", "posts", "userId")
      .join("id", "profiles", "userId"),
  );

  const postTitle: string = users[0].relations.posts[0].title;

  const profileBio: string = users[0].relations.profiles[0].bio;

  void postTitle;
  void profileBio;
}

async function verifyNestedJoin() {
  const posts = replica.query("posts").join("id", "comments", "postId");

  const users = await replica.find(
    replica.query("users").join("id", "posts", "userId", posts),
  );

  const postTitle: string = users[0].relations.posts[0].title;

  const commentBody: string =
    users[0].relations.posts[0].relations.comments[0].body;

  void postTitle;
  void commentBody;
}

replica.query("users").and("active", "=", [true]);

// @ts-expect-error unknown table
replica.query("orders");

// @ts-expect-error unknown column
replica.query("users").and("unknown", "=", ["value"]);

void verifyNoJoin;
void verifyOneJoin;
void verifyMultipleJoin;
void verifyNestedJoin;
