export interface CacheLike {
  get(key: string): string | null;
  put(key: string, value: string, expirationInSeconds?: number): void;
  remove(key: string): void;
}

export interface CacheServiceLike {
  getScriptCache(): CacheLike;
}

export interface UtilitiesLike {
  getUuid(): string;
  sleep(milliseconds: number): void;
}
