import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SheetDB } from "../../src/SheetDB";
import { SheetTable } from "../../src/SheetTable";
import { InMemoryDataStore } from "../doubles/InMemoryDataStore";
import { InMemoryGateway } from "../doubles/InMemoryGateway";

const createDb = (
  onDelete: "cascade" | "set null" | "restrict",
  userRows: any[][] = [[1, "Alice"]],
  postRows: any[][] = [[10, 1, "Hello"]],
) => {
  const userSchema = z.object({
    id: z.number(),
    name: z.string(),
  });
  const postSchema = z.object({
    id: z.number(),
    userId: z.number().nullable(),
    title: z.string(),
  });

  const users = new SheetTable("db", "users", userSchema, "id", false);
  const posts = new SheetTable("db", "posts", postSchema, "id", false);
  posts.reference("userId", users, "id", onDelete);

  const store = new InMemoryDataStore(
    new Map([
      ["db:users", [["id", "name"], ...userRows]],
      ["db:posts", [["id", "userId", "title"], ...postRows]],
    ]),
  );
  const gateway = new InMemoryGateway(store);
  return new SheetDB([users, posts] as const, gateway);
};

describe("Referential Integrity", () => {
  it("存在する親Recordへのforeign keyを許可する", () => {
    const db = createDb("restrict", [[1, "Alice"]], []);

    expect(
      db.table("posts").create([{ id: 10, userId: 1, title: "Hello" }]),
    ).toEqual([{ id: 10, userId: 1, title: "Hello" }]);
  });

  it("存在しない親Recordへのforeign keyを拒否する", () => {
    const db = createDb("restrict", [[1, "Alice"]], []);

    expect(() =>
      db.table("posts").create([{ id: 10, userId: 999, title: "Hello" }]),
    ).toThrow(
      "Foreign key violation: posts.userId=999 references users.id",
    );
  });

  it("null foreign keyを許可する", () => {
    const db = createDb("set null", [[1, "Alice"]], []);

    expect(
      db.table("posts").create([{ id: 10, userId: null, title: "Hello" }]),
    ).toEqual([{ id: 10, userId: null, title: "Hello" }]);
  });

  it("cascadeで子Recordを削除する", () => {
    const db = createDb("cascade");

    db.table("users").delete([1]);

    expect(db.table("users").find()).toEqual([]);
    expect(db.table("posts").find()).toEqual([]);
  });

  it("set nullで子Recordのforeign keyをnullにする", () => {
    const db = createDb("set null");

    db.table("users").delete([1]);

    expect(db.table("users").find()).toEqual([]);
    expect(db.table("posts").find()).toEqual([
      { id: 10, userId: null, title: "Hello" },
    ]);
  });

  it("restrictで参照中の親Record削除を拒否する", () => {
    const db = createDb("restrict");

    expect(() => db.table("users").delete([1])).toThrow(
      "Delete restricted: users.id is referenced by posts.userId",
    );

    expect(db.table("users").find()).toEqual([{ id: 1, name: "Alice" }]);
    expect(db.table("posts").find()).toEqual([
      { id: 10, userId: 1, title: "Hello" },
    ]);
  });

  it("cascadeを多段で適用する", () => {
    const userSchema = z.object({ id: z.number() });
    const postSchema = z.object({ id: z.number(), userId: z.number() });
    const commentSchema = z.object({ id: z.number(), postId: z.number() });
    const users = new SheetTable("db", "users", userSchema, "id", false);
    const posts = new SheetTable("db", "posts", postSchema, "id", false);
    const comments = new SheetTable("db", "comments", commentSchema, "id", false);
    posts.reference("userId", users, "id", "cascade");
    comments.reference("postId", posts, "id", "cascade");

    const store = new InMemoryDataStore(
      new Map([
        ["db:users", [["id"], [1]]],
        ["db:posts", [["id", "userId"], [10, 1]]],
        ["db:comments", [["id", "postId"], [100, 10]]],
      ]),
    );
    const db = new SheetDB(
      [users, posts, comments] as const,
      new InMemoryGateway(store),
    );

    db.table("users").delete([1]);

    expect(db.table("users").find()).toEqual([]);
    expect(db.table("posts").find()).toEqual([]);
    expect(db.table("comments").find()).toEqual([]);
  });
});
