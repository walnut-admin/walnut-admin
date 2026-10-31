import { createKeyv, Keyv } from '@keyv/redis'
import { CacheModuleOptions, CacheOptionsFactory } from '@nestjs/cache-manager'
import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

// eslint-disable-next-line import/no-mutable-exports
export let keyvInst: Keyv

@Injectable()
export class CacheConfigService implements CacheOptionsFactory {
  private readonly logger = new Logger(CacheConfigService.name)

  constructor(private readonly configService: ConfigService) {}

  createCacheOptions(): CacheModuleOptions {
    this.logger.log(`Connecting to redis server...`)

    const host = this.configService.get('app.redis.host') as string
    const port = this.configService.get('app.redis.port') as number

    keyvInst = createKeyv({
      socket: {
        host,
        port,
      },
      password: this.configService.get('app.redis.pass'),
      ttl: this.configService.get('app.cache.ttl'),
    })

    keyvInst.on('error', (err) => {
      console.error('Connection Error', err)
      throw new InternalServerErrorException(
        `RedisService: Failed to connect to Redis server at ${host}:${port}`,
      )
    })

    return {
      isGlobal: true,
      stores: [keyvInst],
    }
  }
}
