import { Replica } from "./Replica";
import type { ReplicaTableDefinition } from "./ReplicaTableDefinition";

export function createReplica<T extends readonly ReplicaTableDefinition[]>({
  name,
  tables,
}: {
  name: string;
  tables: T;
}): Replica<T> {
  return new Replica({
    name,
    tables,
  });
}
