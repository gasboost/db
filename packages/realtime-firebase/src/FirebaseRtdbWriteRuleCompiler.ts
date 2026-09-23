import { FirebaseRtdbInvariantCompiler } from "./FirebaseRtdbInvariantCompiler";
import { FirebaseRtdbLayout } from "./FirebaseRtdbLayout";
import { FirebaseRtdbPredicateCompiler } from "./FirebaseRtdbPredicateCompiler";
import type {
  FirebaseRtdbLayoutResolver,
  FirebaseRtdbPrincipalMapping,
} from "./FirebaseRtdbTypes";

export class FirebaseRtdbWriteRuleCompiler {
  private readonly layoutDefinition: FirebaseRtdbLayout;

  private readonly principalMapping: FirebaseRtdbPrincipalMapping;

  private readonly resolveLayout?: FirebaseRtdbLayoutResolver;

  public constructor({
    layout,
    principal,
    resolveLayout,
  }: {
    layout: FirebaseRtdbLayout;
    principal: FirebaseRtdbPrincipalMapping;
    resolveLayout?: FirebaseRtdbLayoutResolver;
  }) {
    this.layoutDefinition = layout;
    this.principalMapping = principal;
    this.resolveLayout = resolveLayout;
  }

  public compile(): string {
    return [
      `(${this.compileInsert()})`,
      `(${this.compileUpdate()})`,
      `(${this.compileDelete()})`,
    ].join(" || ");
  }

  public compileInsert(): string {
    const policy = this.layoutDefinition.policy();

    if (policy === null || policy.insert === null) {
      return "!data.exists() && newData.exists() && false";
    }

    const compiler = new FirebaseRtdbPredicateCompiler({
      type: "next",
      layout: this.layoutDefinition,
      principal: this.principalMapping,
      resolveLayout: this.resolveLayout,
    });

    const invariant = new FirebaseRtdbInvariantCompiler(this.layoutDefinition, {
      principal: this.principalMapping,
      resolveLayout: this.resolveLayout,
    }).compile("next");

    return [
      "!data.exists()",
      "newData.exists()",
      `(${compiler.compileAuthorized(policy.insert.check)})`,
      `(${invariant})`,
    ].join(" && ");
  }

  public compileUpdate(): string {
    const policy = this.layoutDefinition.policy();

    if (policy === null || policy.update === null) {
      return "data.exists() && newData.exists() && false";
    }

    const currentCompiler = new FirebaseRtdbPredicateCompiler({
      type: "current",
      layout: this.layoutDefinition,
      principal: this.principalMapping,
      resolveLayout: this.resolveLayout,
    });

    const nextCompiler = new FirebaseRtdbPredicateCompiler({
      type: "next",
      layout: this.layoutDefinition,
      principal: this.principalMapping,
      resolveLayout: this.resolveLayout,
    });

    const invariantCompiler = new FirebaseRtdbInvariantCompiler(
      this.layoutDefinition,
      {
        principal: this.principalMapping,
        resolveLayout: this.resolveLayout,
      },
    );

    return [
      "data.exists()",
      "newData.exists()",
      `(${currentCompiler.compileAuthorized(policy.update.using)})`,
      `(${invariantCompiler.compile("current")})`,
      `(${nextCompiler.compileAuthorized(policy.update.check)})`,
      `(${invariantCompiler.compile("next")})`,
    ].join(" && ");
  }

  public compileDelete(): string {
    const policy = this.layoutDefinition.policy();

    if (policy === null || policy.delete === null) {
      return "data.exists() && !newData.exists() && false";
    }

    const compiler = new FirebaseRtdbPredicateCompiler({
      type: "current",
      layout: this.layoutDefinition,
      principal: this.principalMapping,
      resolveLayout: this.resolveLayout,
    });

    const invariant = new FirebaseRtdbInvariantCompiler(this.layoutDefinition, {
      principal: this.principalMapping,
      resolveLayout: this.resolveLayout,
    }).compile("current");

    return [
      "data.exists()",
      "!newData.exists()",
      `(${compiler.compileAuthorized(policy.delete.using)})`,
      `(${invariant})`,
    ].join(" && ");
  }
}
