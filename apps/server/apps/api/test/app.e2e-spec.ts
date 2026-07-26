import type { INestApplication } from '@nestjs/common'
import type { Server } from 'node:http'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '@/app/app.module'

describe('AppController (e2e)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('/ (GET)', () => {
    return request(app.getHttpServer() as Server)
      .get('/')
      .expect(200)
      .expect('Hello World!')
  })
})
