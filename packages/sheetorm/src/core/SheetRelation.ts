import { Relationable } from "./Relationable";

export type OnDeleteAction = "cascade" | "set null" | "restrict";

export class SheetRelation {
  constructor(
    public readonly parentKey: string,
    public readonly childTable: Relationable<any>,
    public readonly childKey: string,
    public readonly onDelete: OnDeleteAction,
  ) {}

  delete(
    records: Record<string, any>[],
    parentKeyValues: any[],
  ): Record<string, any>[] {
    const relatedRecords = records.filter((record) =>
      parentKeyValues.includes(record[this.childKey]),
    );

    if (this.onDelete === "restrict" && relatedRecords.length > 0) {
      throw new Error(
        `Delete restricted by relation '${this.childTable.name}.${this.childKey}'.`,
      );
    }

    return records.reduce<Record<string, any>[]>((acc, record) => {
      const parentDeleted = parentKeyValues.includes(record[this.childKey]);

      if (parentDeleted && this.onDelete === "cascade") {
        return acc;
      }

      if (parentDeleted && this.onDelete === "set null") {
        acc.push({
          ...record,
          [this.childKey]: null,
        });
        return acc;
      }

      acc.push(record);
      return acc;
    }, []);
  }
}
