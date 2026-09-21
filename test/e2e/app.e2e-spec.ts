import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '@/app.module'

describe('App (e2e)', () => {
  let app: INestApplication
  let httpServer: App

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleRef.createNestApplication()
    await app.init()

    httpServer = app.getHttpServer() as App
  })

  afterAll(async () => {
    await app.close()
  })

  it('GET /health responde ok', async () => {
    const response = await request(httpServer).get('/health').expect(200)

    const body = response.body as { status: string }
    expect(body.status).toBe('ok')
  })
})
