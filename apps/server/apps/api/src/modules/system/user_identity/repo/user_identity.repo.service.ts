import { Injectable } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut/db'

import { ClientSession, Types } from 'mongoose'

import {
  ISysUserIdentityModel,
  IWalnutAdminConstSysUserIdentityPurpose,
  IWalnutAdminConstSysUserIdentityType,
  SysUserIdentityModel,
} from '../schema/user_identity.schema'

@Injectable()
export class SysUserIdentityRepositoryService {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_USER_IDENTITY)
    private readonly UserIdentityModel: ISysUserIdentityModel,
  ) {}

  async getValueByUserIdTypeAndPurpose(
    userId: string,
    type: IWalnutAdminConstSysUserIdentityType,
    purpose: IWalnutAdminConstSysUserIdentityPurpose,
    dbSession?: ClientSession,
  ) {
    const target = await this.UserIdentityModel
      .findOne({
        userId: new Types.ObjectId(userId),
        type,
        purpose,
      })
      .select('+value')
      .session(dbSession!)
      .exec()
    return target?.value
  }

  // Find identity by userId, type and purpose
  async findByUserIdTypeAndPurpose(
    userId: string,
    type: IWalnutAdminConstSysUserIdentityType,
    purpose: IWalnutAdminConstSysUserIdentityPurpose,
    dbSession?: ClientSession,
  ) {
    return this.UserIdentityModel
      .findOne({
        userId: new Types.ObjectId(userId),
        type,
        purpose,
      })
      .session(dbSession!)
      .exec()
  }

  // Find all identities by userId
  async findByUserId(
    userId: string,
    dbSession?: ClientSession,
  ) {
    return this.UserIdentityModel
      .find({
        userId: new Types.ObjectId(userId),
      })
      .session(dbSession!)
      .exec()
  }

  // Find identity by type, purpose and value hash (for checking existence)
  async findByValueHash(
    type: IWalnutAdminConstSysUserIdentityType,
    purpose: IWalnutAdminConstSysUserIdentityPurpose,
    valueHash: string,
    dbSession?: ClientSession,
  ) {
    return this.UserIdentityModel
      .findOne({
        type,
        purpose,
        valueHash,
      })
      .session(dbSession!)
      .exec()
  }

  // Create identity
  async createIdentity(
    payload: Partial<SysUserIdentityModel>,
    dbSession?: ClientSession,
  ) {
    payload.userId = new Types.ObjectId(payload.userId)

    if (dbSession) {
      const [newIdentity] = await this.UserIdentityModel.create(
        [payload],
        { session: dbSession },
      )
      return newIdentity
    }

    return this.UserIdentityModel.create(payload)
  }

  // Update identity by userId, type and purpose
  async updateByUserIdTypeAndPurpose(
    userId: string,
    type: IWalnutAdminConstSysUserIdentityType,
    purpose: IWalnutAdminConstSysUserIdentityPurpose,
    payload: Partial<SysUserIdentityModel>,
    dbSession?: ClientSession,
  ) {
    return this.UserIdentityModel
      .findOneAndUpdate(
        {
          userId: new Types.ObjectId(userId),
          type,
          purpose,
        },
        payload,
        { returnDocument: 'after' },
      )
      .session(dbSession!)
      .exec()
  }

  // Delete identity by userId, type and purpose
  async deleteByUserIdTypeAndPurpose(
    userId: string,
    type: IWalnutAdminConstSysUserIdentityType,
    purpose: IWalnutAdminConstSysUserIdentityPurpose,
    dbSession?: ClientSession,
  ) {
    return this.UserIdentityModel
      .findOneAndDelete({
        userId: new Types.ObjectId(userId),
        type,
        purpose,
      })
      .session(dbSession!)
      .exec()
  }
}
