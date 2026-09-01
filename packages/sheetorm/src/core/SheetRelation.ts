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
    pkValues: any[],
  ): Record<string, any>[] {
    // それ以外はそのまま返す
    const deleted = records.reduce((acc, record) => {
      const parentDeleted = pkValues.includes(record[this.childKey]);
      if (parentDeleted && this.onDelete === "cascade") return acc;
      if (parentDeleted && this.onDelete === "set null")
        record[this.childKey] = null;

      acc.push(record);
      return acc;
    }, []);
    return deleted as Record<string, any>[];
  }
}
