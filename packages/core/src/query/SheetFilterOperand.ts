export type Operand =
    | "="
    | "<"
    | ">"
    | "<="
    | ">="
    | "!="
    | "*"
    | "!*"
    | "^*"
    | "*$";

export class SheetFilterOperand {
    constructor(private operand: Operand) {}

    isMoreThanOrLessThan(): boolean {
        return (
            this.operand === "<" ||
            this.operand === ">" ||
            this.operand === "<=" ||
            this.operand === ">="
        );
    }

    isStringOperator(): boolean {
        return (
            this.operand === "*" ||
            this.operand === "!*" ||
            this.operand === "^*" ||
            this.operand === "*$"
        );
    }

    isEqualityOperator(): boolean {
        return this.operand === "=" || this.operand === "!=";
    }

    public compareNumber(value: number, criteria: number[]): boolean {
        switch (this.operand) {
            case "=":
                return criteria.some((time) => time === value);
            case "<":
                return value < Math.min(...criteria);
            case ">":
                return value > Math.max(...criteria);
            case "<=":
                return value <= Math.min(...criteria);
            case ">=":
                return value >= Math.max(...criteria);
            case "!=":
                return !criteria.every((time) => time === value);
            default:
                throw new Error(
                    `Operand ${this.operand} is not supported for number`,
                );
        }
    }

    public compare(value: any, criteria: any[]): boolean {
        switch (this.operand) {
            case "=":
                return criteria.includes(value);
            case "!=":
                return !criteria.includes(value);
            default:
                throw new Error(
                    `Operand ${this.operand} is not supported for type`,
                );
        }
    }

    public compareString(value: string, criteria: string[]): boolean {
        switch (this.operand) {
            case "=":
                return criteria.includes(value);
            case "!=":
                return !criteria.includes(value);
            case "*":
                return criteria.some((needle) => value.includes(needle));
            case "!*":
                return criteria.every((needle) => !value.includes(needle));
            case "^*":
                return criteria.some((prefix) => value.startsWith(prefix));
            case "*$":
                return criteria.some((suffix) => value.endsWith(suffix));
            default:
                throw new Error(
                    `Operand ${this.operand} is not supported for string`,
                );
        }
    }
}
