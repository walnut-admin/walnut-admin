/**
 * SSE (Server-Sent Events) contract — OAuth login token delivery.
 */

import type { ValueOf } from 'easy-fns-ts'

/** SSE event names on the OAuth login token channel */
export const WalnutAdminSseEvents = {
  OAUTH_GITEE: 'token:gitee',
  OAUTH_GITHUB: 'token:github',
} as const

/** Type for SSE event values: 'token:gitee' | 'token:github' */
export type IWalnutAdminSseEvents = ValueOf<typeof WalnutAdminSseEvents>

/**
 * SSE client data envelope — server `IWalnutAdminSseClientData`.
 * `data` carries the event-specific payload (e.g. `IWalnutAdminSseOAuthPayload`).
 */
export interface IWalnutAdminSseClientData<T = any> {
  success: boolean
  message: string
  data: T
}

/**
 * OAuth login token payload — the `data` of a successful SSE message.
 * `event` names the provider channel (`WalnutAdminSseEvents`).
 */
export interface IWalnutAdminSseOAuthPayload {
  event: IWalnutAdminSseEvents
  accessToken: string
  sessionKey: string
}
