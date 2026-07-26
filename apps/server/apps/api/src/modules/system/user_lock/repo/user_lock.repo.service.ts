import { Injectable } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut/db'
import { compare } from 'bcryptjs'
import { ClientSession, Types } from 'mongoose'

import { ISysUserLockDocument, ISysUserLockModel } from '../schema/user_lock.schema'

@Injectable()
export class SysUserLockRepositoryService {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_USER_LOCK)
    private readonly SysUserLockModel: ISysUserLockModel,
  ) {}

  /**
   * @description compare password with hash
   */
  async compareLockPwdHash(pwd: string, hashedPwd: string) {
    return compare(pwd, hashedPwd)
  }

  /**
   * @description find user lock pre by user id
   */
  async findUserLockPreByUserId(userId: string, dbSession?: ClientSession) {
    return this.SysUserLockModel.findOne({ userId: new Types.ObjectId(userId) }).session(dbSession!).exec()
  }

  /**
   * @description insert or update user lock preference
   */
  async insertOrUpdateUserLockPre(userId: string, userLockPre: Partial<ISysUserLockDocument>, dbSession?: ClientSession) {
    return this.SysUserLockModel
      .findOneAndUpdate(
        { userId: new Types.ObjectId(userId) },
        userLockPre,
        { upsert: true, returnDocument: 'after' },
      )
      .session(dbSession!)
      .exec()
  }
}
