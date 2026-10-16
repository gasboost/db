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
    const metadata = root.child("__gasboost").child("tableVersions");
    metadata.set(".write", false);
    const resolveLayout = (tableName: string) => rtdb.layout(tableName);

    for (const table of rtdb.tables()) {
      const layout = rtdb.layout(table.name);

      const policy = layout.policy();

      if (policy === null) {
        const tableNode = root.child(layout.tableName());

        tableNode.set(".read", true);
        tableNode.set(".write", true);
        tableNode.set(".indexOn", "__syncVersion");
        metadata.child(layout.tableName()).set(".read", true);

        continue;
      }

      const location = FirebaseRtdbRulesLocation.generate({
        root,
        layout,
      });

      const scopeNode = location.node();
      scopeNode.set(".indexOn", "__syncVersion");
      const metadataLocation = FirebaseRtdbRulesLocation.generate({
        root: metadata,
        layout,
      });
      const metadataNode = metadataLocation.node();

      if (policy.select === null) {
        scopeNode.set(".read", false);
        metadataNode.set(".read", false);
      } else {
        const scopeCompiler = new FirebaseRtdbPredicateCompiler({
          type: "scope",
          layout,
          principal: rtdb.principal(),
          variables: location.variables(),
          resolveLayout,
        });

        const readable = scopeCompiler.compileAuthorized(policy.select.using);
        scopeNode.set(".read", readable);
        metadataNode.set(".read", readable);
      }

      // RTDB grants cascade: the authorized scope read also covers minimal
      // tombstones, even when their original RLS fields/relations no longer exist.
      const recordNode = scopeNode.child("$recordId");

      if (policy.select === null) {
        recordNode.set(".read", false);
      } else {
        const recordCompiler = new FirebaseRtdbPredicateCompiler({
          type: "current",
          layout,
          principal: rtdb.principal(),
          resolveLayout,
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
          resolveLayout,
        }).compile(),
      );

      recordNode.set(
        ".validate",
        new FirebaseRtdbInvariantCompiler(layout, {
          principal: rtdb.principal(),
          resolveLayout,
        }).compile("next"),
      );
    }

    return {
      rules: root.toJson(),
    };
  }
}
