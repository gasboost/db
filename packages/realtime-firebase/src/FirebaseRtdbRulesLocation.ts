import { FirebaseRtdbLayout } from "./FirebaseRtdbLayout";
import { FirebaseRtdbPathSegment } from "./FirebaseRtdbPathSegment";
import { FirebaseRtdbRulesNode } from "./FirebaseRtdbRulesNode";

export class FirebaseRtdbRulesLocation {
  private readonly ruleNode: FirebaseRtdbRulesNode;

  private readonly scopeVariables: ReadonlyMap<string, string>;

  public constructor({
    node,
    variables,
  }: {
    node: FirebaseRtdbRulesNode;
    variables: ReadonlyMap<string, string>;
  }) {
    this.ruleNode = node;
    this.scopeVariables = variables;
  }

  public static generate({
    root,
    layout,
  }: {
    root: FirebaseRtdbRulesNode;
    layout: FirebaseRtdbLayout;
  }): FirebaseRtdbRulesLocation {
    let node = root.child(
      FirebaseRtdbPathSegment.generate(layout.tableName()).toString(),
    );

    const variables = new Map<string, string>();

    if (layout.bindings().length === 0) {
      return new FirebaseRtdbRulesLocation({
        node,
        variables,
      });
    }

    node = node.child("__rls");

    layout.bindings().forEach((binding, index) => {
      node = node.child(
        FirebaseRtdbPathSegment.generate(binding.column()).toString(),
      );

      const source = binding.source();

      if (source.type === "literal") {
        node = node.child(
          FirebaseRtdbPathSegment.generate(source.value).toString(),
        );

        return;
      }

      const variable = binding.scopeVariable(index);

      if (variable === null) {
        throw new Error(
          `RTDB scope variable for '${binding.column()}' was not generated.`,
        );
      }

      variables.set(binding.column(), variable);

      node = node.child(variable);
    });

    return new FirebaseRtdbRulesLocation({
      node,
      variables,
    });
  }

  public node(): FirebaseRtdbRulesNode {
    return this.ruleNode;
  }

  public variables(): ReadonlyMap<string, string> {
    return this.scopeVariables;
  }
}
