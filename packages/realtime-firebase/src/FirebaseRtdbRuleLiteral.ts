export class FirebaseRtdbRuleLiteral {
  public static generate(value: unknown): string {
    if (value === null) {
      return "null";
    }

    if (typeof value === "string") {
      return JSON.stringify(value);
    }

    if (typeof value === "boolean") {
      return String(value);
    }

    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new Error(
          "Firebase Security Rules do not support non-finite numeric literals.",
        );
      }

      return String(value);
    }

    throw new Error(
      "Firebase Security Rules literal must be string, number, boolean, or null.",
    );
  }
}
