import { Injectable } from '@nestjs/common'
import { IWalnutAdminConstRevokeRTType } from '@walnut/const/app/setting'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut/db'
import { ClientSession, Types } from 'mongoose'

import { IAuthRefreshTokenDocument, IAuthRefreshTokenModel } from '../schema/refresh.schema'

@Injectable()
export class AuthRefreshRepositoryService {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.AUTH_REFRESH_TOKEN)
    private readonly AuthRefreshTokenModel: IAuthRefreshTokenModel,
  ) {}

  /**
   * @description find all refresh token for user
   */
  async findAllRTForUser(userId: string, dbSession?: ClientSession) {
    return this.AuthRefreshTokenModel.find({
      userId: new Types.ObjectId(userId),
    }).session(dbSession!)
  }

  /**
   * @description find refresh token by device id and user id
   */
  async findByDeviceIdAndUserId(
    deviceId: string,
    userId: string,
    dbSession?: ClientSession,
  ) {
    return this.AuthRefreshTokenModel.findOne({
      deviceId,
      userId: new Types.ObjectId(userId),
    }).session(dbSession!)
  }

  /**
   * @description find refresh token by jti
   */
  async findByJti(jti: string, dbSession?: ClientSession) {
    const query = this.AuthRefreshTokenModel.findOne({ jti })

    if (dbSession) {
      query.session(dbSession)
    }

    return query
  }

  /**
   * @description find expired refresh tokens
   */
  async findExpiredTokens(now: Date) {
    return this.AuthRefreshTokenModel.find({ expiredAt: { $lt: now } })
  }

  /**
   * @description update revoked status
   */
  async updateRevokedAndReason(
    userId: string,
    deviceId: string,
    revoked: boolean,
    dbSession: ClientSession,
    revokeReason?: IWalnutAdminConstRevokeRTType,
  ) {
    const target = await this.findByDeviceIdAndUserId(deviceId, userId, dbSession)
    if (!target)
      return false

    target.revoked = revoked
    if (revokeReason) {
      target.revokeReason = revokeReason
    }
    await target.save({ session: dbSession })
    return true
  }

  /**
   * @description update token data (expiredAt, encryptedToken, revoked)
   */
  async saveRefreshTokenDoc(
    document: IAuthRefreshTokenDocument,
    data: {
      expiredAt?: Date
      encryptedToken?: string
      revoked?: boolean
    },
    dbSession?: ClientSession,
  ) {
    if (data.expiredAt !== undefined) {
      document.expiredAt = data.expiredAt
    }
    if (data.encryptedToken !== undefined) {
      document.encryptedToken = data.encryptedToken
    }
    if (data.revoked !== undefined) {
      document.revoked = data.revoked
    }

    await document.save({ session: dbSession })
    return document
  }

  /**
   * @description create new refresh token
   */
  async create(
    data: {
      jti: string
      deviceId: string
      encryptedToken: string
      userId: string
      expiredAt: Date
    },
    dbSession: ClientSession,
  ) {
    // NOTICE: create with session, first param need to be an array
    const [doc] = await this.AuthRefreshTokenModel.create(
      [
        {
          jti: data.jti,
          deviceId: data.deviceId,
          encryptedToken: data.encryptedToken,
          userId: new Types.ObjectId(data.userId),
          expiredAt: data.expiredAt,
        },
      ],
      { session: dbSession },
    )
    return doc
  }
}
