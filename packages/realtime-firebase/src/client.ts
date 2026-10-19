/** RTDB notification path; subscribe with the official Firebase client SDK. */
export function versionPath(tableName: string): string {
  return `/syncVersions/${tableName}`;
}
