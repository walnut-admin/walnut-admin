import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createClient, RedisClientType } from 'redis'

@Injectable()
export class AppTechRedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AppTechRedisService.name)

  private client: RedisClientType

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    this.logger.log('Initializing Redis client...')

    this.client = createClient({
      socket: {
        host: this.configService.get('app.redis.host'),
        port: this.configService.get('app.redis.port'),
      },
      password: this.configService.get('app.redis.pass'),
    })

    await this.client.connect()

    this.logger.log('Redis client connected.')
  }

  async onModuleDestroy() {
    await this.client.quit()

    this.logger.log('Redis client disconnected.')
  }

  getClient(): RedisClientType {
    return this.client
  }

  /**
   * 根据 pattern 批量删除 key（使�?SCAN，安全）
   */
  async delByPattern(
    pattern: string,
    batchSize = 100,
  ): Promise<number> {
    let deleted = 0
    const pipeline: string[] = []

    for await (const key of this.client.scanIterator({
      MATCH: pattern,
      COUNT: batchSize,
    })) {
      pipeline.push(...key)

      if (pipeline.length >= batchSize) {
        deleted += await this.client.del(pipeline)
        pipeline.length = 0
      }
    }

    // 清理剩余�?
    if (pipeline.length > 0) {
      deleted += await this.client.del(pipeline)
    }

    if (deleted > 0) {
      this.logger.debug(
        `delByPattern executed - pattern="${pattern}", deleted=${deleted}`,
      )
    }

    return deleted
  }
}
