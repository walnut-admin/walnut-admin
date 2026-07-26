import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  MongooseModuleOptions,
  MongooseOptionsFactory,
} from '@nestjs/mongoose'
import { Recordable } from 'easy-fns-ts'
import { logExecutionTime, LoggerVerbosity } from 'mongoose-execution-time'

@Injectable()
export class WalnutDBConfigService implements MongooseOptionsFactory {
  private readonly logger = new Logger(WalnutDBConfigService.name)

  constructor(private readonly configService: ConfigService) {}

  createMongooseOptions(): MongooseModuleOptions {
    const uri = `mongodb://${this.configService.get<string>(
      'database.user',
    )}:${this.configService.get<string>(
      'database.pass',
    )}@${this.configService.get<string>(
      'database.primary',
    )},${this.configService.get<string>(
      'database.secondary',
    )},${this.configService.get<string>('database.arbiter')}`

    this.logger.log('[MongooseLog] Initiating database module...')

    return {
      uri,

      appName: this.configService.get<string>('app.name'),
      servername: this.configService.get<string>('app.servername'),

      // necesssary
      dbName: this.configService.get<string>('database.name'),
      authSource: this.configService.get<string>('database.source'),
      replicaSet: this.configService.get<string>('database.replicaset'),

      onConnectionCreate: (connection) => {
        connection.on('connected', () => this.logger.log('[MongooseLog] DB connected'))
        connection.on('open', () => this.logger.log('[MongooseLog] DB open'))
        connection.on('disconnected', () => this.logger.log('[MongooseLog] DB disconnected'))
        connection.on('reconnected', () => this.logger.log('[MongooseLog] DB reconnected'))
        connection.on('disconnecting', () => this.logger.log('[MongooseLog] DB disconnecting'))

        connection.plugin(logExecutionTime, {
          loggerVerbosity: LoggerVerbosity.High,
          loggerFunction: (operation: string, collectionName: string, executionTimeMS: number, _filter: Recordable, _update: Recordable, _additionalLogProperties: Recordable, aggregationPipeline: Recordable[]) => {
            const lines = [
              `[Mongoose] ${operation} | ${collectionName} | ${executionTimeMS}ms`,
            ]

            if (Array.isArray(aggregationPipeline) && aggregationPipeline?.length) {
              aggregationPipeline.forEach((stage: Recordable, i) => {
                const stageKey = Object.keys(stage)[0]
                lines.push(`  [${i + 1}] ${stageKey}: ${JSON.stringify(stage[stageKey])}`)
              })
            }

            this.logger.log(lines.join('\n'))
          },
        })

        return connection
      },
    }
  }
}
