import { Module } from '@nestjs/common'
import { SharedMaskService } from './mask.service'

// F-15（ARCH-02）：@Global 已摘除 —— 全仓只有 AppErrorService 一个注入方，且其所在模块
// （../error/error.module.ts）已显式 import 本模块，全局可见性纯多余、只会让依赖关系在
// 模块图上不可见（行为零变化）。新消费方请显式 import；直到同一 provider 真有两个及以上
// 模块消费时才考虑恢复 @Global。
@Module({
  providers: [SharedMaskService],
  exports: [SharedMaskService],
})
export class SharedMaskModule {}
