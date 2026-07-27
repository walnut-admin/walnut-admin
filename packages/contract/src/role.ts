/**
 * Role name constants — shared between frontend and backend.
 * Backend-specific IDs (RootId, DeveloperId, SafeUserId, SafeRoleId) stay in server.
 */

export const Role = {
  ROOT: 'root',
  DEVELOPER: 'developer',
  ADMIN: 'admin',
  VISITOR: 'visitor',
} as const
