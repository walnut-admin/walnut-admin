const DEFAULT_PREFIX = 'WA'

export function getStorageKey(key: string, prefix?: string) {
  return `${(prefix || DEFAULT_PREFIX).toLocaleUpperCase()}__${key.replaceAll('-', '_').toLocaleUpperCase()}`
}

/**
 * Remove all items in storage whose keys contain the specified substring
 * @param storage The storage to remove items from
 * @param substring The substring to match
 * @returns Array of removed key names
 */
export function removeStorageItemsContaining(storage: Storage, substring: string): string[] {
  const removedKeys: string[] = []
  const allKeys = Array.from({ length: storage.length }, (_, i) => storage.key(i))

  allKeys.forEach((key) => {
    if (key && key.includes(substring)) {
      storage.removeItem(key)
      removedKeys.push(key)
    }
  })

  return removedKeys
}
