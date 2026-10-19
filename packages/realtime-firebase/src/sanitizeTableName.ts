/** Normalize a logical table name to one RTDB path segment in GAS or Browser. */
export function sanitizeTableName(tableName: string): string {
  const sanitized = tableName.replace(/[\u0000-\u001f\u007f-\u009f.#$\[\]\/]/g, "");
  if (sanitized.length === 0) {
    throw new Error("Table name is empty after RTDB path normalization.");
  }
  return sanitized;
}
