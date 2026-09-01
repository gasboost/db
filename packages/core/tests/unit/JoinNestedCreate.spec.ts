import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CacheLike, CacheServiceLike, UtilitiesLike } from "../../src/RuntimeTypes";
import { SheetDB } from "../../src/SheetDB";
import { SheetTable } from "../../src/SheetTable";
import { InMemoryDataStore } from "../doubles/InMemoryDataStore";
import { InMemoryGateway } from "../doubles/InMemoryGateway";

class MemoryCache implements CacheLike {
  private values = new Map<string, string>();
  get(key: string) { return this.values.get(key) ?? null; }
  put(key: string, value: string) { this.values.set(key, value); }
  remove(key: string) { this.values.delete(key); }
}

const runtime = () => {
  const cache = new MemoryCache();
  let uuid = 0;
  const CacheService: CacheServiceLike = { getScriptCache: () => cache };
  const Utilities: UtilitiesLike = {
    getUuid: () => `uuid-${++uuid}`,
    sleep: () => undefined,
  };
  return { CacheService, Utilities };
};

const userSchema = z.object({
  id: z.number(),
  name: z.string(),
});
const postSchema = z.object({
  id: z.string(),
  userId: z.number(),
  title: z.string(),
});
const commentSchema = z.object({
  id: z.number(),
  postId: z.string(),
  body: z.string(),
});

const createDb = () => {
  const store = new InMemoryDataStore(
    new Map([
      ["db:users", [["id", "name"], [1, "Alice"], [2, "Bob"]]],
      [
        "db:posts",
        [
          ["id", "userId", "title"],
          ["p1", 1, "First"],
          ["p2", 1, "Second"],
          ["p3", 2, "Third"],
        ],
      ],
      [
        "db:comments",
        [
          ["id", "postId", "body"],
          [1, "p1", "one"],
          [2, "p1", "two"],
        ],
      ],
    ]),
  );
  const gateway = new InMemoryGateway(store);
  const users = new SheetTable("db", "users", userSchema, "id", true);
  const posts = new SheetTable("db", "posts", postSchema, "id", true, {
    autoNumberingMode: "uuid",
  });
  const comments = new SheetTable("db", "comments", commentSchema, "id", true);
  posts.reference("userId", users, "id", "cascade");
  comments.reference("postId", posts, "id", "cascade");
  const { CacheService, Utilities } = runtime();
  return {
    db: new SheetDB([users, posts, comments] as const, gateway, CacheService, Utilities),
    store,
  };
};

describe("JOIN / Nested Create", () => {
  it("JOIN結果をplain objectの配列として埋め込む", () => {
    const { db } = createDb();
    const query = db
      .query("users")
      .join("id", "posts", "userId");

    expect(db.find(query)).toEqual([
      {
        id: 1,
        name: "Alice",
        posts: [
          { id: "p1", userId: 1, title: "First" },
          { id: "p2", userId: 1, title: "Second" },
        ],
      },
      {
        id: 2,
        name: "Bob",
        posts: [{ id: "p3", userId: 2, title: "Third" }],
      },
    ]);
  });

  it("JOIN先queryと再帰JOINを適用する", () => {
    const { db } = createDb();
    const postQuery = db
      .query("posts")
      .and("title", "=", ["First"])
      .join("id", "comments", "postId");
    const query = db
      .query("users")
      .join("id", "posts", "userId", postQuery);

    expect(db.find(query)).toEqual([
      {
        id: 1,
        name: "Alice",
        posts: [
          {
            id: "p1",
            userId: 1,
            title: "First",
            comments: [
              { id: 1, postId: "p1", body: "one" },
              { id: 2, postId: "p1", body: "two" },
            ],
          },
        ],
      },
      { id: 2, name: "Bob", posts: [] },
    ]);
  });

  it("Nested Createで親キーを子FKへ設定し多段作成する", () => {
    const { db } = createDb();
    const created = db.table("users").createNested([
      {
        record: { name: "Carol" },
        relations: {
          posts: [
            {
              record: { title: "Nested" },
              relations: {
                comments: [
                  { record: { body: "hello" } },
                ],
              },
            },
          ],
        },
      },
    ]);

    expect(created).toEqual([
      {
        id: 3,
        name: "Carol",
        posts: [
          {
            id: "uuid-2",
            userId: 3,
            title: "Nested",
            comments: [
              { id: 3, postId: "uuid-2", body: "hello" },
            ],
          },
        ],
      },
    ]);

    expect(db.table("posts").find()).toContainEqual({
      id: "uuid-2",
      userId: 3,
      title: "Nested",
    });
    expect(db.table("comments").find()).toContainEqual({
      id: 3,
      postId: "uuid-2",
      body: "hello",
    });
  });

  it("Nested Createで指定された子FKは親キーで上書きする", () => {
    const { db } = createDb();
    const created = db.table("users").createNested([
      {
        record: { name: "Carol" },
        relations: {
          posts: [
            { record: { userId: 999, title: "Nested" } },
          ],
        },
      },
    ]);

    expect(created[0].posts?.[0].userId).toBe(3);
  });
});
