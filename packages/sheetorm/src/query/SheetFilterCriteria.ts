export class SheetFilterCriteria {
    constructor(private values: (string | number | Date | boolean)[]) {
        if (values.length === 0) throw new Error("values must not be empty");
        const firstType = typeof values[0];
        if (firstType === "object") return;

        const isSameType = values.every(
            (v) => v !== null && v !== undefined && typeof v === firstType,
        );

        if (!isSameType) {
            throw new Error("values must be all the same type");
        }
    }

    isDate(): boolean {
        return (
            Object.prototype.toString.call(this.values[0]) === "[object Date]"
        );
    }

    getValue() {
        return this.values;
    }

    getTimes() {
        if (!this.isDate()) {
            throw new Error("values are not Date type");
        }
        return this.values.map((v) => (v as Date).getTime());
    }

    isStringOrBoolean(): boolean {
        return (
            typeof this.values[0] === "string" ||
            typeof this.values[0] === "boolean"
        );
    }

    isString(): boolean {
        return typeof this.values[0] === "string";
    }
}
