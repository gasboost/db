/** Called inside the consumer's existing table lock. Gaps after publish errors are allowed. */
export interface VersionStore {
  next(tableName: string): number;
}

/** Structural subset of GAS Properties, usable without GAS ambient types. */
export interface VersionProperties {
  getProperty(key: string): string | null;
  setProperty(key: string, value: string): unknown;
}

export class PropertiesVersionStore implements VersionStore {
  constructor(private readonly properties: VersionProperties) {}

  next(tableName: string): number {
    const key = `rtdb:version:${tableName}`;
    const raw = this.properties.getProperty(key);
    const current = raw === null ? 0 : Number(raw);
    if (
      (raw !== null && raw.trim() === "") ||
      !Number.isSafeInteger(current) ||
      current < 0 ||
      current >= Number.MAX_SAFE_INTEGER
    ) {
      throw new Error(`Invalid or exhausted RTDB version for '${tableName}'.`);
    }
    const next = current + 1;
    this.properties.setProperty(key, String(next));
    return next;
  }
}
