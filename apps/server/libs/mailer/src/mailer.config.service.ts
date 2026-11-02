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
        // libs 解耦批 3：视图模板仍留在 apps/api/src/views（资源由 nest-cli 的 assets 拷到
        // 产物根 apps/api/src/views，产物根按画像是 dist / dist-stage）。lib 产物在
        // <产物根>/libs/mailer/src，故从这里回退到产物根再进 apps/api/src/views ——
        // 与 main.ts 的 setBaseViewsDir 同源。注意：这是运行期路径字符串，编译期不可见，
        // 挪动 views 或产物布局时这里只会运行期炸。
        dir: join(__dirname, '../../../apps/api/src/views/template/mailer'),
        adapter: new HandlebarsAdapter(),
        options: {
          strict: true,
        },
      },
    }
  }
}
