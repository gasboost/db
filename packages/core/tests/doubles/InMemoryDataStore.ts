export interface Stockable {
  get(key: string): { headers: any[]; rows: any[][] };
  set(key: string, rows: any[][]): void;
  dump(): any[][];
}

export class InMemoryDataStore {
  constructor(
    private storage: Map<string, any[][]> = new Map<string, any[][]>(),
  ) {}

  get(key: string): { headers: any[]; rows: any[][] } {
    if (!this.storage.has(key)) {
      throw new Error(`No data for key: ${key}`);
    }

    const rows = this.storage.get(key);
    if (!rows) {
      return { headers: [], rows: [] };
    }

    return {
      headers: rows[0],
      rows: rows.slice(1),
    };
  }

  set(key: string, rows: any[][]): void {
    this.storage.set(key, rows);
  }

  dump(): any[][] {
    const keys = this.storage.keys();

    return Array.from(keys)
      .map((key) => {
        const { headers, rows } = this.get(key)!;
        return [headers, ...structuredClone(rows)];
      })
      .flat();
  }
}
