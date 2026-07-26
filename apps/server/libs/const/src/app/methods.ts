import type { ValueOf } from 'easy-fns-ts'

// app supported http methods
export const WalnutAdminConstAppHTTPMethods = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  PATCH: 'PATCH',
  DELETE: 'DELETE',
  OPTIONS: 'OPTIONS',
  HEAD: 'HEAD',
} as const

export type IWalnutAdminConstAppHTTPMethods = ValueOf<
  typeof WalnutAdminConstAppHTTPMethods
>
