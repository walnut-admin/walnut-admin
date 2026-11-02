import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysDeptBasicRepository } from './dept.basic.repository'
import { SysDeptEntity } from './entity/dept.entity'

/**
 * 部门仓库模块 —— 只装配 `SysDeptBasicRepository`，**不含 controller**。
 *
 * 拆出来的原因：数据权限模块需要按用户部门取子树 / 祖先链（DEPT_AND_CHILD 的解析，
 * 以及部门移动后的缓存失效反查），但它不应把部门 controller 拉进更早的模块装载顺序
 * （否则 Swagger 的路径顺序会整体漂移，openapi diff 变成几千行噪音）。
 *
 * 模块图：DataScopeModule → SysDeptRepoModule；SysDeptModule → SysDeptRepoModule
 * （并对外 re-export，employee 等模块的既有消费面不变）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SysDeptEntity], WalnutPGConnectionName),
  ],
  providers: [SysDeptBasicRepository],
  exports: [SysDeptBasicRepository],
})
export class SysDeptRepoModule {}
