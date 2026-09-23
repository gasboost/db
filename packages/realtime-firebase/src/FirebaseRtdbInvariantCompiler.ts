import { FirebaseRtdbLayout } from "./FirebaseRtdbLayout";
import { FirebaseRtdbRelationCompiler } from "./FirebaseRtdbRelationCompiler";
import { FirebaseRtdbRuleLiteral } from "./FirebaseRtdbRuleLiteral";
import type {
  FirebaseRtdbLayoutResolver,
  FirebaseRtdbPrincipalMapping,
  FirebaseRtdbSnapshotKind,
} from "./FirebaseRtdbTypes";

export class FirebaseRtdbInvariantCompiler {
  private readonly layoutDefinition: FirebaseRtdbLayout;
  private readonly principalMapping: FirebaseRtdbPrincipalMapping;
  private readonly resolveLayout?: FirebaseRtdbLayoutResolver;

  public constructor(
    layout: FirebaseRtdbLayout,
    {
      principal = {},
      resolveLayout,
    }: {
      principal?: FirebaseRtdbPrincipalMapping;
      resolveLayout?: FirebaseRtdbLayoutResolver;
    } = {},
  ) {
    this.layoutDefinition = layout;
    this.principalMapping = principal;
    this.resolveLayout = resolveLayout;
  }

  public compile(snapshot: FirebaseRtdbSnapshotKind): string {
    const source = snapshot === "current" ? "data" : "newData";

    const conditions: string[] = [
      `$recordId === (${source}.child(${JSON.stringify(this.layoutDefinition.primaryKey())}).val() + '')`,
    ];

    const compiledRelations = new Set<object>();

    this.layoutDefinition.bindings().forEach((binding, index) => {
      if (binding.type() === "relation") {
        const origin = binding.origin();

        if (origin === null || compiledRelations.has(origin)) {
          return;
        }

        compiledRelations.add(origin);

        const relationBindings =
          this.layoutDefinition.relationBindingsFor(origin);

        conditions.push(
          new FirebaseRtdbRelationCompiler({
            type: snapshot,
            layout: this.layoutDefinition,
            principal: this.principalMapping,
            resolveLayout: this.resolveLayout,
          }).compileRecord(relationBindings, snapshot),
        );

        return;
      }

      const sourceDefinition = binding.source();

      const value = `${source}.child(${JSON.stringify(binding.column())}).val()`;

      if (sourceDefinition.type === "principal") {
        const variable = binding.scopeVariable(index);

        if (variable === null) {
          throw new Error(
            `RTDB scope variable for '${binding.column()}' was not generated.`,
          );
        }

        conditions.push(`${variable} === (${value} + '')`);

        return;
      }

      conditions.push(
        `${value} === ${FirebaseRtdbRuleLiteral.generate(sourceDefinition.value)}`,
      );
    });

    return conditions.map((condition) => `(${condition})`).join(" && ");
  }
}
