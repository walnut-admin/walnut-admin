import { AsyncLocalStorage } from 'node:async_hooks'
import { Injectable, Logger } from '@nestjs/common'

interface RequestContext {
  snapshotBefore?: Record<string, any>
  snapshotAfter?: Record<string, any>
  authIdtifier?: string
}

@Injectable()
export class ALSRequestService {
  private readonly als = new AsyncLocalStorage<RequestContext>()
  private readonly logger = new Logger(ALSRequestService.name)

  run<T>(callback: () => T): T {
    const result = this.als.run({}, callback)
    return result
  }

  set<K extends keyof RequestContext>(key: K, value: RequestContext[K]) {
    const store = this.als.getStore()
    this.logger.log(`Setting ${key}, store exists: ${!!store}`)

    if (store) {
      store[key] = value
      this.logger.log(`${key} after set: ${JSON.stringify(store[key])}`)
    }
    else {
      this.logger.warn(`No ALS store found when setting ${key}. This means ALS scope is not active.`)
    }
  }

  get<K extends keyof RequestContext>(key: K): RequestContext[K] | undefined {
    const store = this.als.getStore()
    this.logger.log(`Getting ${key}, store exists: ${!!store}`)

    if (store) {
      const value = store[key]
      this.logger.log(`${key} value: ${JSON.stringify(value)}`)
      return value
    }

    this.logger.warn(`No ALS store found when getting ${key}.`)
    return undefined
  }
}
