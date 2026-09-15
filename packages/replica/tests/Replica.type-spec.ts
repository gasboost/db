import { Query } from "@gasboost/query";
import { z } from "zod";
import { createReplica } from "../src";

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
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
  const users = await replica.find(new Query<typeof tables, "users">("users"));

  const id: string = users[0].id;
  const name: string = users[0].name;

  // @ts-expect-error JOIN なしでは relations は存在しない
  users[0].relations;

  void id;
  void name;
}

async function verifyOneJoin() {
  const users = await replica.find(
    new Query<typeof tables, "users">("users").join("id", "posts", "userId"),
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
    new Query<typeof tables, "users">("users")
      .join("id", "posts", "userId")
      .join("id", "profiles", "userId"),
  );

  const postTitle: string = users[0].relations.posts[0].title;

  const profileBio: string = users[0].relations.profiles[0].bio;

  void postTitle;
  void profileBio;
}

async function verifyNestedJoin() {
  const posts = new Query<typeof tables, "posts">("posts").join(
    "id",
    "comments",
    "postId",
  );

  const users = await replica.find(
    new Query<typeof tables, "users">("users").join(
      "id",
      "posts",
      "userId",
      posts,
    ),
  );

  const postTitle: string = users[0].relations.posts[0].title;

  const commentBody: string =
    users[0].relations.posts[0].relations.comments[0].body;

  void postTitle;
  void commentBody;
}

void verifyNoJoin;
void verifyOneJoin;
void verifyMultipleJoin;
void verifyNestedJoin;
