import type { IAppKeyDocument } from './schema/key.schema'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut/db'
import { WalnutAdminExceptionNotFound } from '@walnut/exceptions/base.exception'

import { WalnutAdminExceptionDataExists } from '@walnut/exceptions/base/400'
import { AppDayjs } from '@walnut/utils/dayjs'
import { ClientSession } from 'mongoose'
import { AppKeyDTOSafe } from './dto/key.dto'
import { AppKeyTypeConst, IAppKeyModel } from './schema/key.schema'

@Injectable()
export class AppKeyService {
  private readonly logger = new Logger(AppKeyService.name)

  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.APP_KEY)
    private readonly AppKeyModel: IAppKeyModel,
  ) {}

  private async generateNewKeyByType(type: AppKeyDTOSafe['type'], version: number, dbSession?: ClientSession) {
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

      let newKey: IAppKeyDocument
      if (dbSession) {
        ;[newKey] = await this.AppKeyModel.create([payload], { session: dbSession })
      }
      else {
        newKey = await this.AppKeyModel.create(payload)
      }

      this.logger.log(`type: ${type} new key generated ${newKey.key}`)

      return newKey
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

      let newKey: IAppKeyDocument
      if (dbSession) {
        ;[newKey] = await this.AppKeyModel.create([payload], { session: dbSession })
      }
      else {
        newKey = await this.AppKeyModel.create(payload)
      }

      this.logger.log(`type: ${type} new key generated ${newKey.key}`)

      return newKey
    }
  }

  /**
   * @description get current active app key by type
   */
  async getCurrentActiveKey(type: AppKeyDTOSafe['type']) {
    return this.AppKeyModel
      .findOne({
        type,
        status: 'ACTIVE',
      })
      .sort({ version: -1 })
      .exec()
  }

  /**
   * @description get current app key by type
   */
  async getCurrent(type: AppKeyDTOSafe['type']): Promise<AppKeyDTOSafe['meta']> {
    if (type === AppKeyTypeConst.RSA_PAIR) {
      const res = await this.getCurrentActiveKey(type)
      return {
        publicKeyPem: res?.meta.publicKeyPem,
        privateKeyPem: res?.meta.privateKeyPem,
      }
    }

    if (type === AppKeyTypeConst.AES_KEY_URL) {
      const res = await this.getCurrentActiveKey(type)
      return {
        keyB64: res?.meta.keyB64,
      }
    }

    return {}
  }

  /**
   * @description rotate app key
   */
  async rotate(type: AppKeyDTOSafe['type'], dbSession?: ClientSession) {
    // 1. find current and deprecate
    const current = await this.AppKeyModel.findOne({ type, status: 'ACTIVE' }).session(dbSession!)
    if (!current) {
      throw new WalnutAdminExceptionNotFound()
    }
    current.status = 'DEPRECATED'
    await current.save({ session: dbSession })

    // 2. create next
    return this.generateNewKeyByType(type, current.version + 1, dbSession)
  }

  /**
   * @description rotate app key for cron job
   */
  async rotateForCronJob(type: AppKeyDTOSafe['type']) {
    const session = await this.AppKeyModel.db.startSession()
    session.startTransaction()
    try {
      const current = await this.getCurrentActiveKey(type)
      if (current && current.validEnd !== null && AppDayjs(current.validEnd).isBefore()) {
        this.logger.log(`Rotating expired key for type: ${type}`)
        await this.rotate(type, session)
      }
      await session.commitTransaction()
    }
    catch (e) {
      this.logger.error(`rotation failed`, e)
      await session.abortTransaction()
    }
    finally {
      void session.endSession()
    }
  }

  /**
   * @description init first document
   */
  async initFirst(type: AppKeyDTOSafe['type']) {
    const exist = await this.AppKeyModel.exists({ type })

    if (exist) {
      throw new WalnutAdminExceptionDataExists()
    }

    return this.generateNewKeyByType(type, 1)
  }
}
