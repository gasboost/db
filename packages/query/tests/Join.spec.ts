import { describe, expect, it, vi } from "vitest";
import type { JoinResolver } from "../src/Join";
import { Join } from "../src/Join";

const joinResolver: JoinResolver = ({ parent, table, children }) => ({
  ...parent,
  joined: {
    table,
    children,
  },
});

describe("Join", () => {
  const join = new Join({
    table: "children",
    localKey: "id",
    foreignKey: "parentId",
  });

  it("1つの親に1つの子を結合する", () => {
    const parents = [{ id: "p1", name: "Parent" }];
    const children = [{ id: "c1", parentId: "p1" }];

    expect(join.combine(parents, children, joinResolver)).toEqual([
      {
        id: "p1",
        name: "Parent",
        joined: {
          table: "children",
          children: [{ id: "c1", parentId: "p1" }],
        },
      },
    ]);
  });

  it("1つの親に複数の子を結合する", () => {
    const parents = [{ id: "p1" }];
    const children = [
      { id: "c1", parentId: "p1" },
      { id: "c2", parentId: "p1" },
    ];

    expect(join.combine(parents, children, joinResolver)).toEqual([
      {
        id: "p1",
        joined: {
          table: "children",
          children,
        },
      },
    ]);
  });

  it("親ごとに対応する子を結合する", () => {
    const parents = [{ id: "p1" }, { id: "p2" }];
    const children = [
      { id: "c1", parentId: "p1" },
      { id: "c2", parentId: "p2" },
    ];

    expect(join.combine(parents, children, joinResolver)).toEqual([
      {
        id: "p1",
        joined: {
          table: "children",
          children: [{ id: "c1", parentId: "p1" }],
        },
      },
      {
        id: "p2",
        joined: {
          table: "children",
          children: [{ id: "c2", parentId: "p2" }],
        },
      },
    ]);
  });

  it("対応する子が存在しない親には空配列を設定する", () => {
    const parents = [{ id: "p1" }];

    expect(join.combine(parents, [], joinResolver)).toEqual([
      {
        id: "p1",
        joined: {
          table: "children",
          children: [],
        },
      },
    ]);
  });

  it("対応する親が存在しない子は無視する", () => {
    const parents = [{ id: "p1" }];
    const children = [{ id: "c1", parentId: "unknown" }];

    expect(join.combine(parents, children, joinResolver)).toEqual([
      {
        id: "p1",
        joined: {
          table: "children",
          children: [],
        },
      },
    ]);
  });

  it("foreignKeyがnullの子は無視する", () => {
    const parents = [{ id: "p1" }];
    const children = [{ id: "c1", parentId: null }];

    expect(join.combine(parents, children, joinResolver)).toEqual([
      {
        id: "p1",
        joined: {
          table: "children",
          children: [],
        },
      },
    ]);
  });

  it("foreignKeyがundefinedの子は無視する", () => {
    const parents = [{ id: "p1" }];
    const children = [{ id: "c1" }];

    expect(join.combine(parents, children, joinResolver)).toEqual([
      {
        id: "p1",
        joined: {
          table: "children",
          children: [],
        },
      },
    ]);
  });

  it("localKeyがnullの親には子を結合しない", () => {
    const parents = [{ id: null }];

    expect(join.combine(parents, [{ parentId: null }], joinResolver)).toEqual([
      {
        id: null,
        joined: {
          table: "children",
          children: [],
        },
      },
    ]);
  });

  it("同じlocalKeyを持つ複数の親へ同じ子を結合する", () => {
    const parents = [
      { id: "p1", name: "A" },
      { id: "p1", name: "B" },
    ];

    const child = { id: "c1", parentId: "p1" };

    expect(join.combine(parents, [child], joinResolver)).toEqual([
      {
        id: "p1",
        name: "A",
        joined: {
          table: "children",
          children: [child],
        },
      },
      {
        id: "p1",
        name: "B",
        joined: {
          table: "children",
          children: [child],
        },
      },
    ]);
  });

  it("元の親Recordを変更しない", () => {
    const parents = [{ id: "p1" }];
    const original = [{ id: "p1" }];

    join.combine(parents, [{ parentId: "p1" }], joinResolver);

    expect(parents).toEqual(original);
  });

  it("結合結果の表現をJoinResolverへ委譲する", () => {
    const parents = [{ id: "p1", children: "original" }];
    const children = [{ id: "c1", parentId: "p1" }];

    const resolver = vi.fn(({ parent, children }) => ({
      ...parent,
      relations: {
        children,
      },
    }));

    expect(join.combine(parents, children, resolver)).toEqual([
      {
        id: "p1",
        children: "original",
        relations: {
          children: [{ id: "c1", parentId: "p1" }],
        },
      },
    ]);

    expect(resolver).toHaveBeenCalledWith({
      parent: { id: "p1", children: "original" },
      table: "children",
      children: [{ id: "c1", parentId: "p1" }],
    });
  });
});
