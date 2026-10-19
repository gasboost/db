import type { TableDefinition } from "@gasboost/table";
import { sanitizeTableName } from "./sanitizeTableName";

/** RTDB notification path; subscribe with the official Firebase client SDK. */
export function versionPath(table: TableDefinition): string {
  return `/syncVersions/${sanitizeTableName(table.name)}`;
}
