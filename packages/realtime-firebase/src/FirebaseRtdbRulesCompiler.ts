import type { FirebaseRtdb } from "./FirebaseRtdb";
import { FirebaseRtdbInvariantCompiler } from "./FirebaseRtdbInvariantCompiler";
import { FirebaseRtdbPredicateCompiler } from "./FirebaseRtdbPredicateCompiler";
import { FirebaseRtdbRulesLocation } from "./FirebaseRtdbRulesLocation";
import { FirebaseRtdbRulesNode } from "./FirebaseRtdbRulesNode";
import type {
  FirebaseRtdbPrincipalMapping,
  FirebaseRtdbRulesJson,
  FirebaseRtdbTableDefinition,
} from "./FirebaseRtdbTypes";
import { FirebaseRtdbWriteRuleCompiler } from "./FirebaseRtdbWriteRuleCompiler";

export class FirebaseRtdbRulesCompiler {
  public static generate(
    rtdb: FirebaseRtdb<
      readonly FirebaseRtdbTableDefinition[],
      FirebaseRtdbPrincipalMapping
    >,
  ): FirebaseRtdbRulesJson {
    const root = new FirebaseRtdbRulesNode();

    for (const table of rtdb.tables()) {
      const layout = rtdb.layout(table.name);

      const policy = layout.policy();

      if (policy === null) {
        const tableNode = root.child(layout.tableName());

        tableNode.set(".read", true);
        tableNode.set(".write", true);

        continue;
      }

      const location = FirebaseRtdbRulesLocation.generate({
        root,
        layout,
      });

      const scopeNode = location.node();

      if (policy.select === null) {
        scopeNode.set(".read", false);
      } else {
        const scopeCompiler = new FirebaseRtdbPredicateCompiler({
          type: "scope",
          layout,
          principal: rtdb.principal(),
          variables: location.variables(),
        });

        scopeNode.set(
          ".read",
          scopeCompiler.compileAuthorized(policy.select.using),
        );
      }

      const recordNode = scopeNode.child("$recordId");

      if (policy.select === null) {
        recordNode.set(".read", false);
      } else {
        const recordCompiler = new FirebaseRtdbPredicateCompiler({
          type: "current",
          layout,
          principal: rtdb.principal(),
        });

        recordNode.set(
          ".read",
          recordCompiler.compileAuthorized(policy.select.using),
        );
      }

      recordNode.set(
        ".write",
        new FirebaseRtdbWriteRuleCompiler({
          layout,
          principal: rtdb.principal(),
        }).compile(),
      );

      recordNode.set(
        ".validate",
        new FirebaseRtdbInvariantCompiler(layout).compile("next"),
      );
    }

    return {
      rules: root.toJson(),
    };
  }
}
