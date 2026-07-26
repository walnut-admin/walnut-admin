import { Injectable, Logger } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut-server/db'
import { ClientSession, Types } from 'mongoose'

import { ISysUserMfaDocument, ISysUserMfaModel } from '../schema/user_mfa.schema'

@Injectable()
export class SysUserMfaRepositoryService {
  private readonly logger = new Logger(SysUserMfaRepositoryService.name)

  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_USER_MFA)
    private readonly UserMfaModel: ISysUserMfaModel,
  ) { }

  /**
   * @description find totp record by user id
   */
  async findTotpByUserId(userId: string, dbSession?: ClientSession) {
    return this.UserMfaModel.findOne({
      userId: new Types.ObjectId(userId),
      type: ['totp'],
    }).session(dbSession!)
  }

  /**
   * @description find active totp record by user id
   */
  async findActiveTotpByUserId(userId: string, dbSession?: ClientSession) {
    return this.UserMfaModel.findOne({
      userId: new Types.ObjectId(userId),
      type: ['totp'],
      status: true,
    }).session(dbSession!)
  }

  /**
   * @description find webauthn record by user id and device id
   */
  async findWebauthnByUserIdAndDeviceId(userId: string, deviceId: string, dbSession?: ClientSession) {
    return this.UserMfaModel.findOne({
      userId: new Types.ObjectId(userId),
      deviceId,
      type: ['webauthn'],
      status: true,
    }).session(dbSession!)
  }

  /**
   * @description find webauthn record by user id
   */
  async findWebauthnByUserId(userId: string, dbSession?: ClientSession) {
    return this.UserMfaModel.findOne({
      userId: new Types.ObjectId(userId),
      type: ['webauthn'],
    }).session(dbSession!)
  }

  /**
   * @description aggregate mfa stats for cron job
   */
  async aggregateMfaStats() {
    return this.UserMfaModel.aggregate<ISysUserMfaDocument & { deviceCount: number }>([
      {
        $match: {
          type: { $in: ['totp', 'webauthn'] },
          status: true,
        },
      },
      {
        $group: {
          _id: '$userId',
          deviceCount: { $sum: 1 },
          devices: {
            $push: {
              type: '$type',
              deviceId: '$deviceId',
              name: '$name',
            },
          },
        },
      },
    ])
  }
}
