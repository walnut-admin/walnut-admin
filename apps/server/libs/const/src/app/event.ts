import type { ValueOf } from 'easy-fns-ts'

export const WalnutAdminConstAppEvent = {

  // used in inceptor to bind the log operate id for the deleted document
  LOG_OPERATE_DELETE: 'event.log.operate.created.delete',
  LOG_OPERATE_DELETE_MANY: 'event.log.operate.created.deleteMany',

} as const

export type IWalnutAdminConstAppEvent = ValueOf<
  typeof WalnutAdminConstAppEvent
>
