/**
 * Role name constants — shared between frontend and backend.
 * Backend-specific IDs (RootId, DeveloperId, SafeUserId, SafeRoleId) stay in server.
 */

import type { ValueOf } from 'easy-fns-ts'

export const Role = {
  ROOT: 'root',
  DEVELOPER: 'developer',
  ADMIN: 'admin',
  VISITOR: 'visitor',
} as const

/** Type for role values: 'root' | 'developer' | 'admin' | 'visitor' */
export type RoleType = ValueOf<typeof Role>
