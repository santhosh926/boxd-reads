type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const caches = new Map<string, Map<string, CacheEntry<unknown>>>();

export function getCachedValue<T>(namespace: string, key: string): T | undefined {
  const cache = caches.get(namespace);
  const entry = cache?.get(key);

  if (!entry) {
    return undefined;
  }

  if (entry.expiresAt <= Date.now()) {
    cache?.delete(key);
    return undefined;
  }

  return cloneCacheValue(entry.value as T);
}

export function setCachedValue<T>(
  namespace: string,
  key: string,
  value: T,
  ttlMs = DEFAULT_TTL_MS
): void {
  const cache = caches.get(namespace) ?? new Map<string, CacheEntry<unknown>>();
  cache.set(key, {
    expiresAt: Date.now() + ttlMs,
    value: cloneCacheValue(value)
  });
  caches.set(namespace, cache);
}

export function clearLookupCaches(): void {
  caches.clear();
}

function cloneCacheValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
