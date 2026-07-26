import type { Recordable } from 'easy-fns-ts'
import { Injectable } from '@nestjs/common'
import { getPackageJsonData } from '@walnut/utils/pkg'
import { I18nContext, I18nService } from 'nestjs-i18n'

const pkg = getPackageJsonData()

@Injectable()
export class AppService {
  constructor(private readonly i18n: I18nService<Recordable>) {}

  async getHello() {
    return this.i18n.t('index.hello', {
      lang: I18nContext.current()?.lang,
    })
  }

  async getHelloAuth() {
    return this.i18n.t('index.hello.user', {
      lang: I18nContext.current()?.lang,
    })
  }

  async getPkgDeps() {
    return {
      dependencies: pkg.dependencies as Recordable,
      devDependencies: pkg.devDependencies as Recordable,
    }
  }
}
