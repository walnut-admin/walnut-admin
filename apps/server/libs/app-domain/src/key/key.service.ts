import type { IWalnutAdminKeyStore } from '@walnut-server/rsa'
import type { EntityManager } from 'typeorm'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminExceptionNotFound } from '@walnut-server/exceptions/base.exception'

import { WalnutAdminExceptionDataExists } from '@walnut-server/exceptions/base/400'
import { AppDayjs } from '@walnut-server/utils/dayjs'
import { AppKeyDTOSafe } from './dto/key.dto'
import { AppKeyEntity } from './entity/key.entity'
import { AppKeyBasicRepository } from './key.basic.repository'
import { AppKeyTypeConst } from './key.const'

/**
 * B4 迁移（service 层）：Mongo model 直持 → AppKeyBasicRepository（PG），事务句柄
 * `dbSession?: ClientSession` → `em?: EntityManager` 纯透传。除数据访问改写外零逻辑改动：
 * - rotateForCronJob 的手动 Mongo session 事务改为 repo.transactional（DataSource.transaction，
 *   cron 无请求上下文；HTTP 侧 rotate 走 controller `ctx.em`，见 key.controller）；
 * - 原 create 按 dbSession 有无分叉的两条路径，PG 侧统一为 repo.create(payload, em)。
 *
 * 批 5：`implements IWalnutAdminKeyStore` 是 libs/rsa 端口绑定的编译期守护 ——
 * SecurityRsaService 只依赖 getCurrent / getCurrentActiveKey 两个方法。绑定在
 * AppKeyModule（@Global）。
 */
@Injectable()
export class AppKeyService implements IWalnutAdminKeyStore {
  private readonly logger = new Logger(AppKeyService.name)

  constructor(
    private readonly appKeyBasicRepo: AppKeyBasicRepository,
  ) {}

  // 返回 undefined 与 Mongo 版推断一致（两个 if 分支都未命中时）——调用方
  // initFirst/rotate 直接透传，controller 侧plainToInstance 承接
  private async generateNewKeyByType(type: AppKeyDTOSafe['type'], version: number, em?: EntityManager): Promise<AppKeyEntity | undefined> {
    if (type === AppKeyTypeConst.RSA_PAIR) {
      const pair = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      })

      const now = Date.now()

      const payload = {
        key: `${type.toLowerCase()}-${now}`,
        type,
        version,
        status: 'ACTIVE' as const,
        validStart: new Date(),
        validEnd: new Date(now + 30 * 24 * 3600 * 1000),
        meta: {
          publicKeyPem: pair.publicKey,
          privateKeyPem: pair.privateKey,
          bits: 2048,
          cipher: 'AES-256-GCM',
        },
      }

      const newKey = await this.appKeyBasicRepo.create(payload, em)

      this.logger.log(`type: ${type} new key generated ${newKey.key}`)

      // P0-6 纵深防御：返回副本显式剔除私钥（DB 实体保留全量 meta 供服务端解密），
      // 不把「响应无私钥」单点押在全局序列化策略上
      const publicMeta: Record<string, unknown> = { ...newKey.meta }
      delete publicMeta.privateKeyPem
      return { ...newKey, meta: publicMeta }
    }

    if (type === AppKeyTypeConst.AES_KEY_URL) {
      const now = Date.now()

      const payload = {
        key: `${type.toLowerCase()}-${now}`,
        type,
        version,
        status: 'ACTIVE' as const,
        validStart: new Date(),
        validEnd: new Date(now + 30 * 24 * 3600 * 1000),
        meta: {
          keyB64: randomBytes(32).toString('base64'),
          bits: 256,
          cipher: 'AES-256-GCM',
        },
      }

      const newKey = await this.appKeyBasicRepo.create(payload, em)

      this.logger.log(`type: ${type} new key generated ${newKey.key}`)

      return newKey
    }
  }

  /**
   * @description get current active app key by type
   */
  async getCurrentActiveKey(type: AppKeyDTOSafe['type']) {
    return this.appKeyBasicRepo.getCurrentActiveKey(type)
  }

  /**
   * @description get current app key by type
   *
   * P0-6（2026-10-28）：HTTP 视图永不下发 RSA 私钥 —— 私钥只留在实体 meta 里，内部
   * 消费方（security/rsa 请求解密）走 `getCurrentActiveKey` 的实体通道；本方法的返回值
   * 只含公开面（RSA publicKeyPem / AES keyB64，后者是前端 URL 掩码所需的客户端分发密钥）。
   */
  async getCurrent(type: AppKeyDTOSafe['type']): Promise<AppKeyDTOSafe['meta']> {
    if (type === AppKeyTypeConst.RSA_PAIR) {
      const res = await this.getCurrentActiveKey(type)
      return {
        publicKeyPem: res?.meta?.publicKeyPem,
      }
    }

    if (type === AppKeyTypeConst.AES_KEY_URL) {
      const res = await this.getCurrentActiveKey(type)
      return {
        keyB64: res?.meta?.keyB64,
      }
    }

    return {}
  }

  /**
   * @description rotate app key
   */
  async rotate(type: AppKeyDTOSafe['type'], em?: EntityManager) {
    // 1. find current and deprecate（P1-1：事务内 FOR UPDATE，两路并发 rotate 由行锁串行化；
    // HTTP 侧 rotate 恒带 @WalnutTx 的 ctx.em，cron 侧由 rotateForCronJob 包 transactional）
    const current = await this.appKeyBasicRepo.getCurrentActiveKey(type, em, true)
    if (!current) {
      throw new WalnutAdminExceptionNotFound()
    }
    current.status = 'DEPRECATED'
    await this.appKeyBasicRepo.save(current, em)

    // 2. create next
    return this.generateNewKeyByType(type, current.version + 1, em)
  }

  /**
   * @description rotate app key for cron job
   *
   * W2-A（2026-11-01）：过期判断从**事务外**移进事务内，且先 `FOR UPDATE` 锁行再重判 ——
   * 原实现「事务外读过期 → 事务内只锁行不重判」在双进程（api + worker 各起一份 cron，
   * 或多副本）交错时：后进者拿到锁时先者已把旧行置 DEPRECATED 并插入 v+1 的新 ACTIVE 行，
   * 后进者的 `rotate` 会再锁到这条新行、把它也 DEPRECATE 并插 v+2 —— 先者的新 key 被
   * 连环作废，等于一次到期触发两次轮换。
   *
   * 现在的形态：`transactional` → `getCurrentActiveKey(type, em, true)` 锁住当前 ACTIVE 行
   * → 锁内重读 `validEnd`。READ COMMITTED 下被阻塞的后进者重读有两种可能，都不会二次
   * 轮换：① 看到先者新插入的 ACTIVE 行（validEnd 未到期）→ 直接返回、跳过；② 看不到
   * 旧行（旧行已被先者置 DEPRECATED，重读返回 null）→ 跳过（若该 null 落在 `rotate`
   * 内部则抛 404 被本方法 catch，同样不轮换）。`rotate` 内部再次 `FOR UPDATE` 同一行
   * （同事务内重入安全，PG 行锁可重入）。
   */
  async rotateForCronJob(type: AppKeyDTOSafe['type']) {
    try {
      await this.appKeyBasicRepo.transactional(async (em) => {
        const current = await this.appKeyBasicRepo.getCurrentActiveKey(type, em, true)
        if (!current || current.validEnd === null || !AppDayjs(current.validEnd).isBefore()) {
          return
        }
        this.logger.log(`Rotating expired key for type: ${type}`)
        await this.rotate(type, em)
      })
    }
    catch (e) {
      this.logger.error(`rotation failed`, e)
    }
  }

  /**
   * @description init first document
   */
  async initFirst(type: AppKeyDTOSafe['type']) {
    const exist = await this.appKeyBasicRepo.existsByType(type)

    if (exist) {
      throw new WalnutAdminExceptionDataExists()
    }

    return this.generateNewKeyByType(type, 1)
  }
}
