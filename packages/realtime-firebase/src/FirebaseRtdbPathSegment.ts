import type { FirebaseRtdbPathValue } from "./FirebaseRtdbTypes";

export class FirebaseRtdbPathSegment {
  private readonly value: string;

  public constructor(value: string) {
    this.value = value;
  }

  public static generate(
    value: FirebaseRtdbPathValue,
  ): FirebaseRtdbPathSegment {
    const segment = String(value);

    if (segment.length === 0) {
      throw new Error("Firebase RTDB path segment must not be empty.");
    }

    if (/[\u0000-\u001F\u007F.#$\[\]\/]/u.test(segment)) {
      throw new Error(
        `Firebase RTDB path segment '${segment}' contains a forbidden character.`,
      );
    }

    return new FirebaseRtdbPathSegment(segment);
  }

  public toString(): string {
    return this.value;
  }
}
