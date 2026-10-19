import type { RtdbTransport } from "./FirebaseRtdbRestTransport";
import type { VersionStore } from "./VersionStore";
import { sanitizeTableName } from "./sanitizeTableName";

/** Synchronous table Version notifications, called inside the consumer's lock. */
export class FirebaseRtdb {
  private readonly tableNamesByPath = new Map<string, string>();

  constructor(
    private readonly config: {
      versionStore: VersionStore;
      transport: RtdbTransport;
    },
  ) {}

  public publish(changes: readonly { table: string }[]): void {
    if (changes.length === 0) return;

    // Validate all destinations before allocating any Versions or sending a PATCH.
    const tablesByPath = new Map<string, string>();
    for (const table of new Set(changes.map((change) => change.table))) {
      const path = `syncVersions/${sanitizeTableName(table)}`;
      const existing = tablesByPath.get(path) ?? this.tableNamesByPath.get(path);
      if (existing !== undefined && existing !== table) {
        throw new Error(
          `RTDB notification path collision between '${existing}' and '${table}'.`,
        );
      }
      tablesByPath.set(path, table);
    }

    for (const [path, table] of tablesByPath) {
      this.tableNamesByPath.set(path, table);
    }
    const updates: Record<string, number> = {};
    for (const [path, table] of tablesByPath) {
      updates[path] = this.config.versionStore.next(table);
    }
    this.config.transport.patch(updates);
  }

  public rules() {
    return {
      rules: {
        ".read": false,
        ".write": false,
        syncVersions: { ".read": "auth != null" },
      },
    };
  }
}
