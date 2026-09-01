import { z } from "zod";
import { SheetDB } from "../../src/SheetDB";
import { SheetTable } from "../../src/SheetTable";

const users = new SheetTable(
  "db",
  "users",
  z.object({ id: z.number(), name: z.string() }),
  "id",
  true,
);
const posts = new SheetTable(
  "db",
  "posts",
  z.object({ id: z.string(), userId: z.number(), title: z.string() }),
  "id",
  true,
  { autoNumberingMode: "uuid" },
);
const comments = new SheetTable(
  "db",
  "comments",
  z.object({ id: z.number(), postId: z.string(), body: z.string() }),
  "id",
  true,
);

posts.reference("userId", users, "id", "cascade");
comments.reference("postId", posts, "id", "cascade");

declare const db: SheetDB<readonly [typeof users, typeof posts, typeof comments]>;

const postQuery = db
  .query("posts")
  .join("id", "comments", "postId");
const userQuery = db
  .query("users")
  .join("id", "posts", "userId", postQuery);
const joined = db.find(userQuery);

const userId: number = joined[0].id;
const postTitle: string = joined[0].posts[0].title;
const commentBody: string = joined[0].posts[0].comments[0].body;
void userId;
void postTitle;
void commentBody;

// @ts-expect-error JOIN columnの値型が一致しない
userQuery.join("name", "posts", "userId");

db.table("users").createNested([
  {
    record: { name: "Alice" },
    relations: {
      posts: [
        {
          record: { title: "Hello" },
          relations: {
            comments: [{ record: { body: "Hi" } }],
          },
        },
      ],
    },
  },
]);

// @ts-expect-error 存在しないtable名はNested Createに指定できない
db.table("users").createNested([{ record: { name: "Alice" }, relations: { unknown: [] } }]);
