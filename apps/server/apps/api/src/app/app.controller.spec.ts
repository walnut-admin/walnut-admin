import type { TestingModule } from '@nestjs/testing'
import { Test } from '@nestjs/testing'
import { I18nService } from 'nestjs-i18n'
import { beforeAll, describe, expect, it } from 'vitest'

import { AppController } from './app.controller'
import { AppService } from './app.service'

describe('appController', () => {
  let app: TestingModule

  beforeAll(async () => {
    app = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: I18nService,
          useValue: { t: (_key: string) => 'Hello World!' },
        },
      ],
    }).compile()
  })

  describe('getHello', () => {
    it('should return the i18n-translated greeting', async () => {
      const appController = app.get(AppController)
      expect(await appController.getHello()).toBe('Hello World!')
    })
  })
})
