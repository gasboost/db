import { z } from "zod";
import { Query, type QueryJoinsOf, type QueryResult } from "../src";

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

const tables = [
  {
    name: "users",
    schema: UserSchema,
  },
  {
    name: "posts",
    schema: PostSchema,
  },
  {
    name: "comments",
    schema: CommentSchema,
  },
  {
    name: "profiles",
    schema: ProfileSchema,
  },
] as const;

const noJoinQuery = new Query<typeof tables, "users">("users");

type NoJoinResult = QueryResult<
  typeof tables,
  "users",
  QueryJoinsOf<typeof noJoinQuery>
>;

declare const noJoinResult: NoJoinResult;

const noJoinId: string = noJoinResult.id;
const noJoinName: string = noJoinResult.name;

// @ts-expect-error JOIN なしでは relations は存在しない
noJoinResult.relations;

const oneJoinQuery = new Query<typeof tables, "users">("users").join(
  "id",
  "posts",
  "userId",
);

type OneJoinResult = QueryResult<
  typeof tables,
  "users",
  QueryJoinsOf<typeof oneJoinQuery>
>;

declare const oneJoinResult: OneJoinResult;

const postId: string = oneJoinResult.relations.posts[0].id;
const postUserId: string = oneJoinResult.relations.posts[0].userId;
const postTitle: string = oneJoinResult.relations.posts[0].title;

// @ts-expect-error posts に存在しない column
oneJoinResult.relations.posts[0].body;

const multipleJoinQuery = new Query<typeof tables, "users">("users")
  .join("id", "posts", "userId")
  .join("id", "profiles", "userId");

type MultipleJoinResult = QueryResult<
  typeof tables,
  "users",
  QueryJoinsOf<typeof multipleJoinQuery>
>;

declare const multipleJoinResult: MultipleJoinResult;

const multiplePostTitle: string = multipleJoinResult.relations.posts[0].title;

const profileBio: string = multipleJoinResult.relations.profiles[0].bio;

const postQuery = new Query<typeof tables, "posts">("posts").join(
  "id",
  "comments",
  "postId",
);

const nestedJoinQuery = new Query<typeof tables, "users">("users").join(
  "id",
  "posts",
  "userId",
  postQuery,
);

type NestedJoinResult = QueryResult<
  typeof tables,
  "users",
  QueryJoinsOf<typeof nestedJoinQuery>
>;

declare const nestedJoinResult: NestedJoinResult;

const nestedPostTitle: string = nestedJoinResult.relations.posts[0].title;

const nestedCommentBody: string =
  nestedJoinResult.relations.posts[0].relations.comments[0].body;

// and() 後も JOIN 型を保持する
const filteredJoinQuery = new Query<typeof tables, "users">("users")
  .join("id", "posts", "userId")
  .and("name", "=", ["Alice"]);

type FilteredJoinResult = QueryResult<
  typeof tables,
  "users",
  QueryJoinsOf<typeof filteredJoinQuery>
>;

declare const filteredJoinResult: FilteredJoinResult;

const filteredPostTitle: string = filteredJoinResult.relations.posts[0].title;

// or() 後も JOIN 型を保持する
const orJoinQuery = new Query<typeof tables, "users">("users")
  .join("id", "posts", "userId")
  .or("name", "=", ["Alice"]);

type OrJoinResult = QueryResult<
  typeof tables,
  "users",
  QueryJoinsOf<typeof orJoinQuery>
>;

declare const orJoinResult: OrJoinResult;

const orPostTitle: string = orJoinResult.relations.posts[0].title;

// orderBy() / offset() / limit() 後も JOIN 型を保持する
const orderedJoinQuery = new Query<typeof tables, "users">("users")
  .join("id", "posts", "userId")
  .orderBy("name")
  .offset(1)
  .limit(10);

type OrderedJoinResult = QueryResult<
  typeof tables,
  "users",
  QueryJoinsOf<typeof orderedJoinQuery>
>;

declare const orderedJoinResult: OrderedJoinResult;

const orderedPostTitle: string = orderedJoinResult.relations.posts[0].title;

void noJoinId;
void noJoinName;
void postId;
void postUserId;
void postTitle;
void multiplePostTitle;
void profileBio;
void nestedPostTitle;
void nestedCommentBody;
void filteredPostTitle;
void orPostTitle;
void orderedPostTitle;
