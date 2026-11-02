import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysUserPreferenceEntity } from './entity/user-preference.entity'
import { SysUserPreferenceService } from './services/user_preference.service'
import { SysUserPreferenceBasicRepository } from './user_preference.basic.repository'

/**
 * B7b 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态，不另建 pg.module）。
 *
 * F-31 重构（裁决 Q6=b）：providers 补上 `SysUserPreferenceBasicRepository` —— 数据面从
 * service 下沉到 Basic Repository（同模块 CRUD），service 只编排。基类仓库的属性注入
 * （ALSRequestService / 软删策略 / 数据权限策略）由既有 @Global 模块提供，与本目录外
 * 的其他 lib 仓库一致，本模块不需要额外的 imports。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SysUserPreferenceEntity], WalnutPGConnectionName),
  ],
  // 批 6：controller 留 app（identity-http.module.ts）
  controllers: [],
  providers: [SysUserPreferenceBasicRepository, SysUserPreferenceService],
  exports: [SysUserPreferenceService],
})
export class SysUserPreferenceModule {}
