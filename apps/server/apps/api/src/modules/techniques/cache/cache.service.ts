import { Injectable, Logger } from '@nestjs/common'
import { IWalnutAdminConstAppCacheType, WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { AppDayjs } from '@walnut-server/utils/dayjs'
import { every, filter, get, isNil, orderBy, slice } from 'lodash'

import sizeof from 'object-sizeof'
import { AppMonitorCacheDTO, AppMonitorCacheDTOListRequest } from '@/modules/app/monitor/cache/dto/cache.dto'
import { AppTechRedisService } from './redis/redis.service'

interface WalnutAdminCacheContent<T = any> extends IWalnutAdminCacheOptions {
  v: T
}

// Note: IWalnutAdminCacheOptions is now defined globally in @walnut-server/types/walnut-admin/cache.d.ts

// 辅助函数：去�?key 的前缀，用于显�?
function getDisplayKey(fullKey: string): string {
  const cachePrefix = 'WALNUT_CACHE_'
  if (fullKey.startsWith(cachePrefix)) {
    return fullKey.substring(cachePrefix.length)
  }
  return fullKey
}

function getWalnutAdminCacheKey(key: string) {
  const cachePrefix = 'WALNUT_CACHE'
  return key.startsWith(cachePrefix) ? key : `${cachePrefix}_${key}`
}

function myPaginate<T>(array: T[], pageNum: number, pageSize: number) {
  const startIndex = (pageNum - 1) * pageSize
  return slice(array, startIndex, startIndex + pageSize)
}

function myFilter(array: AppMonitorCacheDTO[], conditions: Partial<AppMonitorCacheDTO>) {
  return filter(array, (item) => {
    return every(conditions, (value, key) => {
      if (isNil(value)) {
        return true
      }

      // 处理数字类型的精确匹�?
      if (typeof value === 'number') {
        return get(item, key) === value
      }

      // 处理布尔类型的精确匹�?
      if (typeof value === 'boolean') {
        return get(item, key) === value
      }

      // 其他类型全部按字符串模糊匹配处理
      const searchTerm = value.toString().toLowerCase()
      const itemValue = get(item, key, '').toString().toLowerCase()
      return itemValue.includes(searchTerm)
    })
  })
}

@Injectable()
export class AppTechCacheService {
  private readonly logger = new Logger(AppTechCacheService.name)

  // 批量获取的批次大�?
  private readonly BATCH_SIZE = 100

  constructor(
    private readonly redisService: AppTechRedisService,
  ) {}

  public get redis() {
    return this.redisService.getClient()
  }

  /**
   * Set cache with custom format
   */
  public async set<T = any>(
    key: string,
    value: T,
    options: IWalnutAdminCacheOptions,
  ) {
    const cacheKey = getWalnutAdminCacheKey(key)

    const ttl = (options?.ttl) ?? 0
    const val: WalnutAdminCacheContent<T> = {
      v: value,
      ttl,
      start: options?.start ?? Date.now(),
      t: options.t,
    }

    const serialized = JSON.stringify(val)

    if (ttl > 0) {
      await this.redis.setEx(cacheKey, ttl, serialized)
      this.logger.debug(`[CacheSet] | Key: ${cacheKey}, TTL: ${ttl}s`)
    }
    else {
      await this.redis.set(cacheKey, serialized)
      this.logger.debug(`[CacheSet] | Key: ${cacheKey}, No Expiration`)
    }
  }

  /**
   * Set cache only when the key does not exist — single-command `SET NX EX`.
   *
   * P2-11（2026-10-29）：一次性语义（sign nonce）不能「GET 后 SET」两步做 ——
   * 并发同键会双双通过。这里把「判存在 + 写入」压成 Redis 单命令，返回 null 即已存在。
   *
   * @returns true = 本次写入成功（键原本不存在）；false = 键已被占用
   */
  public async setIfAbsent<T = any>(
    key: string,
    value: T,
    options: IWalnutAdminCacheOptions,
  ): Promise<boolean> {
    const cacheKey = getWalnutAdminCacheKey(key)

    const ttl = (options?.ttl) ?? 0
    const val: WalnutAdminCacheContent<T> = {
      v: value,
      ttl,
      start: options?.start ?? Date.now(),
      t: options.t,
    }

    const serialized = JSON.stringify(val)

    const result = ttl > 0
      ? await this.redis.set(cacheKey, serialized, { NX: true, EX: ttl })
      : await this.redis.set(cacheKey, serialized, { NX: true })

    this.logger.debug(`[CacheSetNx] | Key: ${cacheKey}, written: ${result !== null}`)

    return result !== null
  }

  /**
   * Get cache value
   */
  public async get<T = any>(key: string): Promise<T | null> {
    const cacheKey = getWalnutAdminCacheKey(key)

    try {
      const cached = await this.redis.get(cacheKey)

      if (isNil(cached)) {
        this.logger.debug(`[CacheGet] | Key not found: ${cacheKey}`)
        return null
      }

      const cache = JSON.parse(cached) as WalnutAdminCacheContent<T>
      this.logger.debug(`[CacheGet] | Key: ${cacheKey}, Retrieved value only`)
      return cache.v
    }
    catch (error) {
      this.logger.error(`[CacheGet] | Error retrieving key: ${cacheKey}`, error)
      return null
    }
  }

  /**
   * Get whole cache content
   */
  public async getWholeCache<T = any>(key: string): Promise<WalnutAdminCacheContent<T> | null> {
    const cacheKey = getWalnutAdminCacheKey(key)

    try {
      const cached = await this.redis.get(cacheKey)

      if (isNil(cached)) {
        this.logger.debug(`[CacheGet Whole] | Key not found: ${cacheKey}`)
        return null
      }

      const parsed = JSON.parse(cached) as WalnutAdminCacheContent<T>
      this.logger.debug(`[CacheGet Whole] | Key: ${cacheKey}, Retrieved with metadata`)
      return parsed
    }
    catch (error) {
      this.logger.error(`[CacheGet Whole] | Error retrieving key: ${cacheKey}`, error)
      return null
    }
  }

  /**
   * Delete cache by key and return how many keys were actually removed.
   *
   * 一次性消费语义（P2-13 OAuth state nonce）专用：`del` 返回旧值（不存在时也为
   * null，无法区分「删了」与「本来就没有」），消费方需要 Redis DEL 的计数做
   * 「先到先得」判定。键前缀与 `del` 同源。
   */
  public async delAndCount(key: string): Promise<number> {
    try {
      return await this.redis.del(getWalnutAdminCacheKey(key))
    }
    catch (error) {
      // F5：Redis 异常不向上抛 —— 消费方（OAuth state 一次性校验）把 0 当作
      // 「消费失败」走受控 40000，而不是 50000 未受控兜底。
      this.logger.error(`[CacheDelAndCount] failed: ${getWalnutAdminCacheKey(key)}`, error)
      return 0
    }
  }

  /**
   * Delete cache by key
   */
  public async del<T = any>(key: string): Promise<T | null> {
    const cacheKey = getWalnutAdminCacheKey(key)
    const target = await this.get<T>(key)

    if (!target) {
      this.logger.log(`[CacheDel] | Cache Delete Target Missing: ${cacheKey}`)
    }

    const deleted = await this.redis.del(cacheKey)

    if (deleted > 0) {
      this.logger.debug(`[CacheDel] | Key deleted: ${cacheKey}`)
    }

    return target
  }

  /**
   * Delete cache by pattern (supports wildcards like a:b:*)
   * @param pattern - Pattern with wildcard support, e.g., 'USER:*', 'SESSION:123:*'
   * @returns Array of deleted keys
   */
  public async delByPattern(pattern: string): Promise<string[]> {
    const cachePattern = getWalnutAdminCacheKey(pattern)
    const matchedKeys: string[] = []

    this.logger.log(`[CacheDelPattern] | Starting deletion for pattern: ${pattern}`)

    // P1-2 修复（2026-10-28）：node-redis v5 的 scanIterator **按批产出 `string[]`**
    // （含空批），旧实现 `Array.isArray(key) ? key[0] : key` 既丢批内其余键、又把空批
    // 变成 `undefined` 混进删除数组 —— 最终 `del` 抛 "must be of type string" 被
    // after-commit 钩子吞掉，会话键因此残留。这里摊平批次并用 unlink 展开删除。
    const batch: string[] = []
    for await (const key of this.redis.scanIterator({
      MATCH: cachePattern,
      COUNT: this.BATCH_SIZE,
    })) {
      const keysOfBatch = Array.isArray(key) ? key : [key]
      batch.push(...keysOfBatch.filter((item): item is string => typeof item === 'string'))

      if (batch.length >= this.BATCH_SIZE) {
        await this.redis.unlink(batch)
        this.logger.debug(`[CacheDelPattern] | Batch deleted ${batch.length} keys`)
        matchedKeys.push(...batch)
        batch.length = 0 // 清空 batch
      }
    }

    // 处理剩余�?
    if (batch.length > 0) {
      await this.redis.unlink(batch)
      matchedKeys.push(...batch)
    }

    this.logger.log(
      `[CacheDelPattern] | Total deleted ${matchedKeys.length} keys matching pattern: ${pattern}`,
    )

    return matchedKeys
  }

  /**
   * Touch cache TTL (not change value, only expire)
   *
   * @param cacheKey cache key
   * @param ttl seconds
   */
  public async expire<T = any>(
    cacheKey: string,
    ttl: number,
  ): Promise<boolean> {
    const fullKey = getWalnutAdminCacheKey(cacheKey)

    // 获取当前缓存内容
    const cached = await this.getWholeCache<T>(fullKey)

    if (!cached) {
      this.logger.warn(`[CacheExpire] | Cache not found: ${fullKey}`)
      return false
    }

    try {
      // 解析并更�?ttl 字段
      cached.ttl = ttl

      // 使用 SET �?EXPIRE 的组合，或者直接用 SETEX
      const serialized = JSON.stringify(cached)

      if (ttl > 0) {
        await this.redis.setEx(fullKey, ttl, serialized)
      }
      else {
      // ttl = 0 表示永不过期
        await this.redis.set(fullKey, serialized)
        await this.redis.persist(fullKey) // 移除过期时间
      }

      this.logger.debug(`[CacheExpire] | Updated TTL for key: ${fullKey}, TTL: ${ttl}s`)
      return true
    }
    catch (error) {
      this.logger.error(`[CacheExpire] | Error updating TTL for key: ${fullKey}`, error)
      return false
    }
  }

  /**
   * Get all cache keys
   */
  public async getAllKeys(): Promise<string[]> {
    const keys: string[] = []
    const pattern = `${getWalnutAdminCacheKey('')}*`

    this.logger.debug(`[CacheGetAllKeys] | Scanning keys with pattern: ${pattern}`)

    for await (const key of this.redis.scanIterator({
      MATCH: pattern,
      COUNT: 100,
    })) {
      if (Array.isArray(key)) {
        keys.push(...key)
      }
      else {
        keys.push(key)
      }
    }

    this.logger.debug(`[CacheGetAllKeys] | Found ${keys.length} keys`)
    return keys
  }

  /**
   * 获取所有缓存数�?(已优化：使用 MGET 批量获取)
   */
  private async getAllCacheData(): Promise<{ [key: string]: WalnutAdminCacheContent }> {
    const allCaches: { [key: string]: WalnutAdminCacheContent } = {}
    const keysBatch: string[] = []
    const pattern = `${getWalnutAdminCacheKey('')}*`

    this.logger.debug(`[CacheGetAllData] | Starting optimized batch scan`)

    // 使用 scanIterator 遍历 key
    for await (const key of this.redis.scanIterator({
      MATCH: pattern,
      COUNT: this.BATCH_SIZE,
    })) {
      // 1. 在获取阶段就过滤掉不需要的 Bull 队列键，减少后续 MGET 的压�?
      if (key.includes('BULL')) {
        continue
      }

      if (Array.isArray(key)) {
        keysBatch.push(...key)
      }
      else {
        keysBatch.push(key)
      }

      // 2. 凑够一批就进行 MGET
      if (keysBatch.length >= this.BATCH_SIZE) {
        await this.fillCacheData(keysBatch, allCaches)
        keysBatch.length = 0 // 清空数组
      }
    }

    // 3. 处理剩余不足一批的 key
    if (keysBatch.length > 0) {
      await this.fillCacheData(keysBatch, allCaches)
    }

    this.logger.debug(`[CacheGetAllData] | Retrieved ${Object.keys(allCaches).length} valid cache entries`)
    return allCaches
  }

  /**
   * 辅助方法：批量获�?key 对应的值并填充�?result 对象�?
   */
  private async fillCacheData(
    keys: string[],
    result: { [key: string]: WalnutAdminCacheContent },
  ) {
    if (keys.length === 0)
      return

    // 使用 mget 一次性获取多个�?
    const values = await this.redis.mGet(keys)

    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]
      const v = values[i]

      if (v !== null) {
        try {
          result[k] = JSON.parse(v) as WalnutAdminCacheContent
        }
        catch (error) {
          this.logger.warn(`[CacheGetAllData] | Failed to parse key: ${k}`, error)
          // 可以在这里选择删除损坏�?key: await this.redis.del(k)
        }
      }
    }
  }

  /**
   * Clear all non-protected caches
   */
  public async clear() {
    const allCachedData = await this.getAllCacheData()

    const cacheTypeDoNotClear: IWalnutAdminConstAppCacheType[] = [
      WalnutAdminConstAppCacheType.BUILT_IN,
      WalnutAdminConstAppCacheType.AUTH,
      WalnutAdminConstAppCacheType.SYSTEM,
    ]

    this.logger.log(`[CacheClear] | Starting cache clear operation`)

    // 获取所有需要删除的 key
    const keysToDelete = Object.entries(allCachedData)
      .filter(([, v]) => !cacheTypeDoNotClear.includes(v.t))
      .map(([k]) => k)

    if (keysToDelete.length === 0) {
      this.logger.log('[CacheClear] | No keys to delete')
      return false
    }

    // 分批删除，避免一次性删除太多导�?Redis 阻塞
    const deletedCount = await this.deleteKeysInBatch(keysToDelete)

    this.logger.log(`[CacheClear] | Cleared ${deletedCount} cache entries`)

    if (deletedCount !== keysToDelete.length) {
      this.logger.error(`[CacheClear] | Failed to delete ${keysToDelete.length - deletedCount} keys`)
      return false
    }

    return true
  }

  /**
   * 辅助方法：分批删�?key
   */
  private async deleteKeysInBatch(keys: string[]): Promise<number> {
    let deletedCount = 0
    for (let i = 0; i < keys.length; i += this.BATCH_SIZE) {
      const batch = keys.slice(i, i + this.BATCH_SIZE)
      // node-redis v5：DEL/UNLINK 收「单键或键数组」，空数组会撞 rest-args 编码
      if (batch.length === 0)
        continue
      const count = await this.redis.unlink(batch)
      deletedCount += count
    }
    return deletedCount
  }

  /**
   * List caches with pagination and filtering
   */
  public async list(payload: AppMonitorCacheDTOListRequest) {
    const allCachedData = await this.getAllCacheData()

    const { sort, query, page } = payload

    this.logger.debug(`[CacheList] | Listing caches - Page: ${page.page}, PageSize: ${page.pageSize}`)

    let cachedArrayData: AppMonitorCacheDTO[] = []

    // format into array
    Object.entries(allCachedData).forEach(([key, value]) => {
      if (isNil(value)) {
        return
      }
      const startTime = AppDayjs(value.start)
      const expireTime = !isNil(value.ttl) ? startTime.add(value.ttl, 'second') : null

      cachedArrayData.push({
        // 使用去除前缀�?key，前端展示更友好
        key: getDisplayKey(key),
        valueBytes: sizeof(value.v),
        expire: !isNil(value.ttl) ? value.ttl : 0,
        type: value.t,
        startTime,
        expireTime,
      })
    })

    cachedArrayData = cachedArrayData.filter(Boolean)

    // sort
    if (sort.length && sort.length !== 0) {
      cachedArrayData = orderBy(
        cachedArrayData,
        sort.map(s => s.field),
        sort.map(s => s.order === 'ascend' ? 'asc' : 'desc'),
      )
    }

    // filter
    if (Object.keys(query).length !== 0) {
      cachedArrayData = myFilter(cachedArrayData, query)
    }

    const total = cachedArrayData.length

    // page
    cachedArrayData = myPaginate(cachedArrayData, page.page, page.pageSize)

    this.logger.debug(`[CacheList] | Returned ${cachedArrayData.length} of ${total} total entries`)

    return {
      data: cachedArrayData,
      total,
    }
  }
}
