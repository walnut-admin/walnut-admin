/**
 * Menu type constants — shared between frontend and backend.
 */

/** Menu item type */
export const MenuType = {
  CATALOG: 'catalog',
  MENU: 'menu',
  ELEMENT: 'element',
} as const

/** Menu internal/external classification */
export const MenuTernal = {
  EXTERNAL: 'external',
  INTERNAL: 'internal',
  NONE: 'none',
} as const

/** Menu cache key strategy */
export const CacheKeyStrategy = {
  NAME: 'name',
  PATH: 'path',
  CUSTOM: 'custom',
} as const
