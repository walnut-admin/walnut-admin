import type { ClientSession } from 'mongoose'
import { Injectable, Logger } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut/db'

import { SysUserDTO } from '../dto/user.dto'
import { ISysUserDocument, ISysUserModel } from '../schema/user.schema'

@Injectable()
export class SysUserRepositoryService {
  private readonly logger = new Logger(SysUserRepositoryService.name)

  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_USER)
    private readonly UserModel: ISysUserModel,
  ) { }

  /**
   * @description find all users
   */
  async findAllUsers() {
    return this.UserModel.find()
  }

  /**
   * @description find user by user id
   */
  async findUserByUserId(userId: string, dbSession?: ClientSession) {
    return this.UserModel.findById(userId).session(dbSession!)
  }

  /**
   * @description find user by user name
   */
  async findUserByUserName(userName: string, dbSession?: ClientSession) {
    return this.UserModel.findOne({ userName }).session(dbSession!)
  }

  /**
   * @description find user by id and update
   */
  async findUserByIdAndUpdate(id: string, update: Partial<ISysUserDocument>, dbSession?: ClientSession) {
    return this.UserModel.findByIdAndUpdate(id, update, { returnDocument: 'after' }).session(dbSession!)
  }

  /**
   * @description check user existence by payload, return user document if existed, otherwise return null
   */
  async checkUserExistence(payload: Partial<SysUserDTO>, dbSession?: ClientSession) {
    return this.UserModel.findOne(payload).session(dbSession!)
  }

  /**
   * @description create a new user
   */
  async createUser(payload: Partial<ISysUserDocument>, dbSession?: ClientSession) {
    if (dbSession) {
      const [newUser] = await this.UserModel.create([payload], { session: dbSession })
      return newUser
    }

    return this.UserModel.create(payload)
  }
}
