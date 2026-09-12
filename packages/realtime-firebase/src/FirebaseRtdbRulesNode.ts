import type { FirebaseRtdbRulesJsonNode } from "./FirebaseRtdbTypes";

export class FirebaseRtdbRulesNode {
  private readonly children: Map<
    string,
    FirebaseRtdbRulesNode | string | boolean
  >;

  public constructor() {
    this.children = new Map();
  }

  public child(name: string): FirebaseRtdbRulesNode {
    const current = this.children.get(name);

    if (current instanceof FirebaseRtdbRulesNode) {
      return current;
    }

    const node = new FirebaseRtdbRulesNode();

    this.children.set(name, node);

    return node;
  }

  public set(name: string, value: string | boolean): void {
    this.children.set(name, value);
  }

  public toJson(): FirebaseRtdbRulesJsonNode {
    const result: FirebaseRtdbRulesJsonNode = {};

    for (const [key, value] of this.children) {
      result[key] =
        value instanceof FirebaseRtdbRulesNode ? value.toJson() : value;
    }

    return result;
  }
}
