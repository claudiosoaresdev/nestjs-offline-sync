import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '@/app.module'
import { DomainEvents } from '@/core/events/domain-events'
import { SEEDED_PRODUCT_IDS } from '@/infrastructure/database/in-memory/products.seed'

describe('Ciclo de entrega (e2e)', () => {
  let app: INestApplication
  let httpServer: App

  const courierId = randomUUID()

  beforeAll(async () => {
    DomainEvents.clearHandlers()
    DomainEvents.clearMarkedAggregates()

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

  it('percorre snapshot, delta, push do campo e avaliação', async () => {
    const created = await request(httpServer)
      .post('/deliveries')
      .send({
        courierId,
        customer: {
          name: 'Maria',
          phone: '11999999999',
          address: 'Rua A, 100',
        },
        items: [{ productId: SEEDED_PRODUCT_IDS.coffee, quantity: 2 }],
      })
      .expect(201)

    const deliveryId = (created.body as { delivery: { id: string } }).delivery
      .id

    const snapshot = await request(httpServer)
      .get(`/couriers/${courierId}/deliveries/snapshot`)
      .query({ withTotal: true })
      .expect(200)

    const snapshotBody = snapshot.body as {
      currentVersion: number
      totalItems: number
      deliveries: { id: string; totalCents: number }[]
    }

    expect(snapshotBody.totalItems).toBe(1)
    expect(snapshotBody.deliveries[0].totalCents).toBe(7980)

    const pushed = await request(httpServer)
      .post(`/couriers/${courierId}/deliveries/events`)
      .send({
        events: [
          {
            clientEventId: randomUUID(),
            deliveryId,
            type: 'OUT_FOR_DELIVERY',
            occurredAt: new Date('2026-09-21T12:00:00.000Z').toISOString(),
          },
          {
            clientEventId: randomUUID(),
            deliveryId,
            type: 'DELIVERED',
            occurredAt: new Date('2026-09-21T12:30:00.000Z').toISOString(),
            receivedBy: 'Porteiro',
          },
        ],
      })
      .expect(200)

    const pushBody = pushed.body as { results: { status: string }[] }
    expect(pushBody.results.map((item) => item.status)).toEqual([
      'APPLIED',
      'APPLIED',
    ])

    await request(httpServer)
      .post(`/deliveries/${deliveryId}/rating`)
      .send({ score: 5, comment: 'Chegou antes do previsto' })
      .expect(201)

    const delta = await request(httpServer)
      .get(`/couriers/${courierId}/deliveries/changes`)
      .query({ sinceVersion: snapshotBody.currentVersion, limit: 100 })
      .expect(200)

    const deltaBody = delta.body as {
      hasMore: boolean
      resyncRequired: boolean
      changes: {
        type: string
        delivery?: { status: string; rating: { score: number } | null }
      }[]
    }

    expect(deltaBody.hasMore).toBe(false)
    expect(deltaBody.resyncRequired).toBe(false)
    expect(deltaBody.changes).toHaveLength(1)
    expect(deltaBody.changes[0].type).toBe('UPSERT')
    expect(deltaBody.changes[0].delivery?.status).toBe('DELIVERED')
    expect(deltaBody.changes[0].delivery?.rating?.score).toBe(5)
  })

  it('rejeita avaliação fora da faixa com 422', async () => {
    const created = await request(httpServer)
      .post('/deliveries')
      .send({
        courierId,
        customer: {
          name: 'João',
          phone: '11988888888',
          address: 'Rua B, 200',
        },
        items: [{ productId: SEEDED_PRODUCT_IDS.mug, quantity: 1 }],
      })
      .expect(201)

    const deliveryId = (created.body as { delivery: { id: string } }).delivery
      .id

    await request(httpServer)
      .post(`/deliveries/${deliveryId}/rating`)
      .send({ score: 9 })
      .expect(422)
  })

  it('rejeita avaliação de entrega não entregue com 409', async () => {
    const created = await request(httpServer)
      .post('/deliveries')
      .send({
        courierId,
        customer: {
          name: 'Ana',
          phone: '11977777777',
          address: 'Rua C, 300',
        },
        items: [{ productId: SEEDED_PRODUCT_IDS.filter, quantity: 1 }],
      })
      .expect(201)

    const deliveryId = (created.body as { delivery: { id: string } }).delivery
      .id

    const response = await request(httpServer)
      .post(`/deliveries/${deliveryId}/rating`)
      .send({ score: 5 })
      .expect(409)

    expect((response.body as { code: string }).code).toBe(
      'DELIVERY_NOT_DELIVERED',
    )
  })
})
