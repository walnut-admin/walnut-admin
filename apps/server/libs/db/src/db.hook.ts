import { AsyncLocalStorage } from 'node:async_hooks'

type TransactionHook = () => Promise<void>

export const DBTransactionHooksStore = new AsyncLocalStorage<TransactionHook[]>()

/**
 * Registers a hook to be executed after the current database transaction commits.
 *
 * This is the **strict** variant — it assumes the caller is guaranteed to be running
 * inside a transaction interceptor context. If no transaction context is found,
 * it throws immediately to surface the misuse as early as possible.
 *
 * Use this when the hook MUST be deferred until after commit and running it
 * outside a transaction would be a programming error (e.g., sending an event
 * that must only fire after data is durably persisted).
 *
 * @param hook - Async callback to invoke after the transaction successfully commits.
 * @throws {Error} If called outside of a transaction interceptor context.
 */
export function registerAfterCommitHook(hook: TransactionHook): void {
  const hooks = DBTransactionHooksStore.getStore()
  if (!hooks) {
    throw new Error(
      'registerAfterCommitHook() must be called within a transaction interceptor context. '
      + 'If the transaction context is optional, use runAfterCommit() instead.',
    )
  }
  hooks.push(hook)
}

/**
 * Schedules a hook to run after the current transaction commits, or runs it
 * immediately if no transaction context is active.
 *
 * This is the **lenient** variant designed for service-layer code that may be
 * invoked both within and outside a transaction (e.g., called directly from a
 * scheduled job, a non-transactional endpoint, or nested inside a transactional one).
 *
 * Behavior:
 * - **Inside a transaction**: the hook is pushed onto the commit queue and will
 *   be executed by the interceptor after the transaction successfully commits.
 *   The current call returns immediately without blocking.
 * - **Outside a transaction**: the hook is awaited inline before returning.
 *
 * @param hook - Async callback to invoke after commit, or immediately if no transaction is active.
 */
export async function runAfterCommit(hook: TransactionHook): Promise<void> {
  const hooks = DBTransactionHooksStore.getStore()
  if (hooks) {
    hooks.push(hook)
  }
  else {
    await hook()
  }
}
