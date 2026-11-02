import { Module } from '@nestjs/common'
import { SecuritySignService } from './sign.service'

@Module({
  imports: [],
  providers: [SecuritySignService],
  exports: [SecuritySignService],
})
export class SecuritySignModule {}
