import { Module } from '@nestjs/common'
import { SecuritySignController } from './sign.controller'
import { SecuritySignService } from './sign.service'

@Module({
  imports: [],
  controllers: [SecuritySignController],
  providers: [SecuritySignService],
  exports: [SecuritySignService],
})
export class SecuritySignModule {}
