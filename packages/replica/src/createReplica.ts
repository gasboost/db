import { Replica } from "./Replica";
import type {
  ReplicaTableDefinition,
  ValidReplicaTables,
} from "./ReplicaTableDefinition";

export function createReplica<
  const T extends readonly ReplicaTableDefinition[],
>({
  name,
  tables,
}: {
  name: string;
  tables: T & ValidReplicaTables<T>;
}): Replica<T> {
  return new Replica<T>({
    name,
    tables,
  });
}
