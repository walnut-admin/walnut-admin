import { Global, Module } from '@nestjs/common'
import { AppTechCryptoService } from './crypto.service'

@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [AppTechCryptoService],
  exports: [AppTechCryptoService],
})
export class AppTechCryptoModule { }
