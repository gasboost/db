import { FirebaseRtdbLayout } from "./FirebaseRtdbLayout";
import { FirebaseRtdbRuleLiteral } from "./FirebaseRtdbRuleLiteral";
import type { FirebaseRtdbSnapshotKind } from "./FirebaseRtdbTypes";

export class FirebaseRtdbInvariantCompiler {
  private readonly layoutDefinition: FirebaseRtdbLayout;

  public constructor(layout: FirebaseRtdbLayout) {
    this.layoutDefinition = layout;
  }

  public compile(snapshot: FirebaseRtdbSnapshotKind): string {
    const source = snapshot === "current" ? "data" : "newData";

    const conditions: string[] = [
      `$recordId === (${source}.child(${JSON.stringify(this.layoutDefinition.primaryKey())}).val() + '')`,
    ];

    this.layoutDefinition.bindings().forEach((binding, index) => {
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
