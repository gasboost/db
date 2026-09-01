export class SheetOrderBy {
    constructor(
        private column: string,
        private direction: "asc" | "desc",
    ) {}

    public sort(a: Record<string, any>, b: Record<string, any>): number {
        const av = a[this.column];
        const bv = b[this.column];

        if (av === bv) return 0;

        const result = av > bv ? 1 : -1;
        if (this.direction === "asc") return result;
        if (this.direction === "desc") return -result;
        throw new Error(`Invalid sort direction: ${this.direction}`);
    }
}
