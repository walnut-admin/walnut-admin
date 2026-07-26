import { Module } from '@nestjs/common'
import { SharedScopeResolverService } from './scope-resolver.service'

@Module({
  providers: [SharedScopeResolverService],
  exports: [SharedScopeResolverService],
})
export class SharedScopeResolverModule {}
