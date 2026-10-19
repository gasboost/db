import type { RtdbTransport } from "./FirebaseRtdbRestTransport";
import type { VersionStore } from "./VersionStore";

/** Synchronous table Version notifications, called inside the consumer's lock. */
export class FirebaseRtdb {
  constructor(
    private readonly config: {
      versionStore: VersionStore;
      transport: RtdbTransport;
    },
  ) {}

  public publish(changes: readonly { table: string }[]): void {
    if (changes.length === 0) return;

    const updates: Record<string, number> = {};
    for (const table of new Set(changes.map((change) => change.table))) {
      updates[`syncVersions/${table}`] = this.config.versionStore.next(table);
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
