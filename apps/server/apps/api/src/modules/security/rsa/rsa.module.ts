import { Global, Module } from '@nestjs/common'
import { AppKeyModule } from '@/modules/app/key/key.module'
import { SecurityRsaController } from './rsa.controller'
import { SecurityRsaService } from './rsa.service'

@Global()
@Module({
  imports: [AppKeyModule],
  controllers: [SecurityRsaController],
  providers: [SecurityRsaService],
  exports: [SecurityRsaService],
})
export class SecurityRsaModule {}
