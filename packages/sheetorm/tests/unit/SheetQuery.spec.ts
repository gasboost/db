import { describe, expect, it } from "vitest";
import { SheetFilter } from "../../src/query/SheetFilter";
import { SheetQuery } from "../../src/query/SheetQuery";

describe("SheetQuery", () => {
  it("IDが必ず1もしくは2で名前が太郎もしくはメールがhanako@example.comの場合、ID1と2が返る", () => {
    const query = new SheetQuery()
      .and("ID", "=", [1, 2])
      .or("名前", "=", ["太郎"])
      .or("メール", "=", ["hanako@example.com"]);

    expect(
      query.filter([
        { ID: 1, 名前: "太郎", メール: "taro@example.com" },
        { ID: 2, 名前: "花子", メール: "hanako@example.com" },
        { ID: 3, 名前: "次郎", メール: "jiro@example.com" },
      ]),
    ).toEqual([
      { ID: 1, 名前: "太郎", メール: "taro@example.com" },
      { ID: 2, 名前: "花子", メール: "hanako@example.com" },
    ]);
  });

  it("get order by", () => {
    const query = new SheetQuery().orderBy("名前", "desc");

    expect(
      query.sort([
        { ID: 1, 名前: "banana", メール: "taro@example.com" },
        { ID: 2, 名前: "apple", メール: "hanako@example.com" },
        { ID: 3, 名前: "cherry", メール: "jiro@example.com" },
      ]),
    ).toEqual([
      { ID: 3, 名前: "cherry", メール: "jiro@example.com" },
      { ID: 1, 名前: "banana", メール: "taro@example.com" },
      { ID: 2, 名前: "apple", メール: "hanako@example.com" },
    ]);
  });

  it("offset", () => {
    const query = new SheetQuery().offset(1);

    expect(
      query.shift([
        { ID: 1, 名前: "banana", メール: "taro@example.com" },
        { ID: 2, 名前: "apple", メール: "hanako@example.com" },
        { ID: 3, 名前: "cherry", メール: "jiro@example.com" },
      ]),
    ).toEqual([
      { ID: 2, 名前: "apple", メール: "hanako@example.com" },
      { ID: 3, 名前: "cherry", メール: "jiro@example.com" },
    ]);
  });

  it("limit", () => {
    const query = new SheetQuery().limit(2);

    expect(
      query.cut([
        { ID: 1, 名前: "banana", メール: "taro@example.com" },
        { ID: 2, 名前: "apple", メール: "hanako@example.com" },
        { ID: 3, 名前: "cherry", メール: "jiro@example.com" },
      ]),
    ).toEqual([
      { ID: 1, 名前: "banana", メール: "taro@example.com" },
      { ID: 2, 名前: "apple", メール: "hanako@example.com" },
    ]);
  });

  it("get joins", () => {
    const postQuery = new SheetQuery().join(
      "著者ID",
      "ユーザー",
      "ID",
      new SheetQuery().and("名前", "=", ["太郎"]),
    );

    expect(postQuery.getJoins()).toEqual([
      expect.objectContaining({
        table: "ユーザー",
        localKey: "著者ID",
        foreignKey: "ID",
        query: expect.objectContaining({
          requires: [new SheetFilter("名前", "=", ["太郎"])],
        }),
      }),
    ]);
  });

  it("1層だけのジョイン", () => {
    const userQuery = new SheetQuery().join("ID", "投稿", "著者ID");

    expect(userQuery.getJoins()).toEqual([
      expect.objectContaining({
        table: "投稿",
        localKey: "ID",
        foreignKey: "著者ID",
        query: null,
      }),
    ]);
  });
});
