export class FilterOperand {
  constructor(private values: (string | number | Date | boolean)[]) {
    if (values.length === 0) {
      throw new Error("values must not be empty");
    }

    if (values[0] instanceof Date) {
      const isSameType = values.every((value) => value instanceof Date);

      if (!isSameType) {
        throw new Error("values must be all the same type");
      }

      return;
    }

    const firstType = typeof values[0];

    const isSameType = values.every(
      (value) =>
        value !== null && value !== undefined && typeof value === firstType,
    );

    if (!isSameType) {
      throw new Error("values must be all the same type");
    }
  }

  isDate(): boolean {
    return this.values[0] instanceof Date;
  }

  getValue() {
    return this.values;
  }

  getTimes() {
    if (!this.isDate()) {
      throw new Error("values are not Date type");
    }

    return this.values.map((value) => (value as Date).getTime());
  }

  isStringOrBoolean(): boolean {
    return (
      typeof this.values[0] === "string" || typeof this.values[0] === "boolean"
    );
  }

  isString(): boolean {
    return typeof this.values[0] === "string";
  }
}
