import type { SheetTable } from "./SheetTable";

export type OnDeleteAction = "cascade" | "set null" | "restrict";

export class SheetRelation {
  constructor(
    public readonly childTable: SheetTable<string, any>,
    public readonly childKey: string,
    public readonly parentTable: SheetTable<string, any>,
    public readonly parentKey: string,
    public readonly onDelete: OnDeleteAction,
  ) {}
}

const outgoingRelations = new WeakMap<object, SheetRelation[]>();
const incomingRelations = new WeakMap<object, SheetRelation[]>();

export function registerRelation(relation: SheetRelation): void {
  const outgoing = outgoingRelations.get(relation.childTable) ?? [];
  const duplicate = outgoing.some(
    (candidate) =>
      candidate.childKey === relation.childKey &&
      candidate.parentTable === relation.parentTable &&
      candidate.parentKey === relation.parentKey,
  );
  if (duplicate) {
    throw new Error(
      `Relation already exists: ${relation.childTable.name}.${relation.childKey} -> ${relation.parentTable.name}.${relation.parentKey}`,
    );
  }

  outgoingRelations.set(relation.childTable, [...outgoing, relation]);
  const incoming = incomingRelations.get(relation.parentTable) ?? [];
  incomingRelations.set(relation.parentTable, [...incoming, relation]);
}

export function getOutgoingRelations(
  table: SheetTable<string, any>,
): readonly SheetRelation[] {
  return outgoingRelations.get(table) ?? [];
}

export function getIncomingRelations(
  table: SheetTable<string, any>,
): readonly SheetRelation[] {
  return incomingRelations.get(table) ?? [];
}
