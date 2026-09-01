import { AccessableDataStore } from "./AccessableDataStore";
import { WriteCommand } from "./commands/WriteCommand";
import { SheetRecords } from "./SheetRecords";
import { SheetTable } from "./SheetTable";

type BufferedCommand = {
  command: WriteCommand;
  key: string;
};

type TableState = {
  table: SheetTable<string, any>;
  original: Record<string, any>[];
  staged: SheetRecords;
};

export class CommandBuffer {
  private active = false;
  private commands: BufferedCommand[] = [];
  private states = new Map<string, TableState>();

  constructor(private readonly gateway: AccessableDataStore) {}

  begin(): void {
    if (this.active) throw new Error("Nested transactions are not supported.");
    this.active = true;
    this.commands = [];
    this.states.clear();
  }

  isActive(): boolean {
    return this.active;
  }

  records(table: SheetTable<string, any>): SheetRecords {
    const key = `${table.dbId}:${table.name}`;
    const existing = this.states.get(key);
    if (existing) return existing.staged;

    this.gateway.table(table.name, table.dbId);
    const original = this.gateway.read().map((record) => ({ ...record }));
    const state = {
      table,
      original,
      staged: new SheetRecords(original.map((record) => ({ ...record })), table.primaryKey as string),
    };
    this.states.set(key, state);
    return state.staged;
  }

  add(command: WriteCommand): void {
    this.commands.push({
      command,
      key: `${command.table.dbId}:${command.table.name}`,
    });
  }

  commit(): void {
    const commitRecords = new Map<string, SheetRecords>();
    try {
      for (const { command, key } of this.commands) {
        const state = this.states.get(key);
        if (!state) throw new Error(`Transaction state '${key}' not found.`);
        let records = commitRecords.get(key);
        if (!records) {
          records = new SheetRecords(
            state.original.map((record) => ({ ...record })),
            state.table.primaryKey as string,
          );
          commitRecords.set(key, records);
        }
        command.execute(records);
      }
    } catch (error) {
      this.restore();
      throw error;
    } finally {
      this.clear();
    }
  }

  abort(): void {
    this.clear();
  }

  private restore(): void {
    for (const state of this.states.values()) {
      this.gateway.table(state.table.name, state.table.dbId);
      this.gateway.rewrite(state.original.map((record) => ({ ...record })));
    }
  }

  private clear(): void {
    this.active = false;
    this.commands = [];
    this.states.clear();
  }
}
