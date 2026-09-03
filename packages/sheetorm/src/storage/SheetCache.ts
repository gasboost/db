import { WriteCommand } from "../commands/WriteCommand";
import { SheetRecords } from "../core/SheetRecords";

export class SheetCache {
  private storage: WriteCommand[] = [];
  private index = 0;
  protected exsist: SheetRecords | null = null;

  add(strategy: WriteCommand) {
    this.storage.push(strategy);
  }

  hasNext(): boolean {
    return this.index < this.storage.length;
  }

  next(): WriteCommand {
    const command = this.storage[this.index];
    this.index++;
    return command;
  }

  clear() {
    this.storage = [];
    this.index = 0;
    this.exsist = null;
  }

  public hasExsist(): boolean {
    return this.exsist !== null;
  }

  public setExsist(exsist: SheetRecords) {
    this.exsist = exsist;
  }

  public getExsist(): Record<string, any>[] {
    return this.exsist?.getValues() || [];
  }
}
