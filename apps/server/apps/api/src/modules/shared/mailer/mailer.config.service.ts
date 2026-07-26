import { join } from 'node:path'
import { MailerOptions, MailerOptionsFactory } from '@nestjs-modules/mailer'
import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter'

import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { isDev } from '@walnut-server/config/utils/env'

@Injectable()
export class AppMailerConfigService implements MailerOptionsFactory {
  private readonly logger = new Logger(AppMailerConfigService.name)

  constructor(private readonly configService: ConfigService) {}

  createMailerOptions(): MailerOptions {
    this.logger.log('[MailLog] Initiating mailer module...')

    return {
      transport: {
        host: this.configService.get('email.host') as string,
        port: this.configService.get('email.port') as string,
        secure: !isDev,
        auth: {
          user: this.configService.get('email.auth.user') as string,
          pass: this.configService.get('email.auth.pass') as string,
        },
      },
      defaults: {
        from: {
          name: this.configService.get('email.defaults.from.name') as string,
          address: this.configService.get('email.defaults.from.address') as string,
        },
      },
      // preview: true,
      template: {
        dir: join(__dirname, '../../../views/template/mailer'),
        adapter: new HandlebarsAdapter(),
        options: {
          strict: true,
        },
      },
    }
  }
}
