import { SheetFilterCriteria } from "./SheetFilterCriteria";
import { Operand, SheetFilterOperand } from "./SheetFilterOperand";
export { Operand };

export class SheetFilter {
    private column: string;
    private operand: SheetFilterOperand;
    private criteria: SheetFilterCriteria;

    constructor(
        column: string,
        operand: Operand,
        values: (string | number | Date | boolean)[],
    ) {
        this.column = column;
        this.operand = new SheetFilterOperand(operand);
        this.criteria = new SheetFilterCriteria(values);

        const isString = this.criteria.isString();

        if (
            this.criteria.isStringOrBoolean() &&
            this.operand.isMoreThanOrLessThan()
        ) {
            throw new Error(`Operand ${operand} is not supported for type`);
        }

        if (!isString && this.operand.isStringOperator()) {
            throw new Error(`Operand ${operand} is not supported for type`);
        }

        if (
            this.criteria.isStringOrBoolean() &&
            !isString &&
            !this.operand.isEqualityOperator()
        ) {
            throw new Error(`Operand ${operand} is not supported for type`);
        }
    }

    // レコードがフィルター条件を満たすかどうか
    isFullfiled(record: Record<string, any>): boolean {
        const value = record[this.column];

        // 日付を比較する
        if (this.criteria.isDate()) {
            const recordTime = value instanceof Date ? value.getTime() : NaN;
            const criteriaTimes = this.criteria.getTimes();
            return this.operand.compareNumber(recordTime, criteriaTimes);
        }

        // 文字列を比較する
        if (this.criteria.isString()) {
            const criteriaValues = this.criteria.getValue() as string[];
            if (typeof value !== "string") {
                return false;
            }
            return this.operand.compareString(value, criteriaValues);
        }

        // booleanを比較する
        if (this.criteria.isStringOrBoolean()) {
            const criteriaValues = this.criteria.getValue();
            return this.operand.compare(value, criteriaValues);
        }

        // 数値を比較する
        const criteria = this.criteria.getValue() as number[];
        return this.operand.compareNumber(value, criteria);
    }
}
