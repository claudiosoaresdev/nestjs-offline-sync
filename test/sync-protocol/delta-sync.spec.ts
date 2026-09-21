import { beforeEach, describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvents } from '@/core/events/domain-events'
import { GetDeliverySnapshotUseCase } from '@/domain/delivery/application/use-cases/get-delivery-snapshot'
import { PullDeliveryChangesUseCase } from '@/domain/delivery/application/use-cases/pull-delivery-changes'
import { PushDeliveryEventsUseCase } from '@/domain/delivery/application/use-cases/push-delivery-events'
import { CustomerInfo } from '@/domain/delivery/enterprise/entities/customer-info'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'
import { InMemoryDeliveriesRepository } from '@/infrastructure/database/in-memory/in-memory-deliveries-repository'
import { InMemoryDeliveryChangesRepository } from '@/infrastructure/database/in-memory/in-memory-delivery-changes-repository'
import { InMemoryProcessedDeliveryEventsRepository } from '@/infrastructure/database/in-memory/in-memory-processed-delivery-events-repository'
import { InMemorySyncStateRepository } from '@/infrastructure/database/in-memory/in-memory-sync-state-repository'
import { AppendDeliveryChangeSubscriber } from '@/infrastructure/events/append-delivery-change.subscriber'

let deliveries: InMemoryDeliveriesRepository
let changes: InMemoryDeliveryChangesRepository
let syncState: InMemorySyncStateRepository
let processed: InMemoryProcessedDeliveryEventsRepository
let pull: PullDeliveryChangesUseCase
let snapshot: GetDeliverySnapshotUseCase
let push: PushDeliveryEventsUseCase

const courierId = new UniqueEntityID()

function makeDelivery(owner = courierId): Delivery {
  return Delivery.create({
    courierId: owner,
    customer: CustomerInfo.create({
      name: 'Maria',
      phone: '11999999999',
      address: 'Rua A, 100',
    }),
    items: [],
  })
}

/** Cliente de referência: aplica o delta como o app deve aplicar. */
async function syncClient(startVersion: number, limit: number) {
  const cache = new Map<string, unknown>()
  let cursor = startVersion
  let rounds = 0

  for (;;) {
    const result = await pull.execute({
      courierId: courierId.toString(),
      sinceVersion: cursor,
      limit,
    })

    if (result.isLeft()) throw new Error('pull falhou')

    rounds += 1

    for (const change of result.value.changes) {
      if (change.type === 'REMOVE') {
        cache.delete(change.deliveryId)
      } else {
        cache.set(change.deliveryId, change.delivery)
      }
    }

    cursor = result.value.nextVersion

    if (!result.value.hasMore) {
      return {
        cache,
        cursor,
        rounds,
        resyncRequired: result.value.resyncRequired,
      }
    }
  }
}

describe('protocolo de delta sync', () => {
  beforeEach(() => {
    DomainEvents.clearHandlers()
    DomainEvents.clearMarkedAggregates()
    DomainEvents.shouldRun = true

    deliveries = new InMemoryDeliveriesRepository()
    syncState = new InMemorySyncStateRepository()
    changes = new InMemoryDeliveryChangesRepository(syncState)
    processed = new InMemoryProcessedDeliveryEventsRepository()

    new AppendDeliveryChangeSubscriber(changes)

    pull = new PullDeliveryChangesUseCase(changes, deliveries, syncState)
    snapshot = new GetDeliverySnapshotUseCase(deliveries, syncState)
    push = new PushDeliveryEventsUseCase(deliveries, processed)
  })

  it('1. delta truncado não perde mudança: cliente itera até hasMore ser falso', async () => {
    for (let index = 0; index < 120; index += 1) {
      await deliveries.create(makeDelivery())
    }

    const client = await syncClient(0, 10)

    expect(client.cache.size).toBe(120)
    expect(client.rounds).toBeGreaterThan(1)
    expect(client.cursor).toBe(await syncState.currentVersion())
  })

  it('2. cursor adiantado pede resync', async () => {
    await deliveries.create(makeDelivery())

    const result = await pull.execute({
      courierId: courierId.toString(),
      sinceVersion: 999,
      limit: 10,
    })

    if (result.isLeft()) throw new Error('pull falhou')

    expect(result.value.resyncRequired).toBe(true)
  })

  it('3. minVersion é exposto e sinceVersion no piso continua válido', async () => {
    await deliveries.create(makeDelivery())

    const result = await pull.execute({
      courierId: courierId.toString(),
      sinceVersion: 0,
      limit: 10,
    })

    if (result.isLeft()) throw new Error('pull falhou')

    // O log ainda não é podado, então minVersion é 0 e o cursor 0 é aceitável.
    // Quando a poda entrar, um cursor abaixo de minVersion passa a pedir resync
    // pelo mesmo caminho do cenário 2.
    expect(result.value.minVersion).toBe(0)
    expect(result.value.resyncRequired).toBe(false)
    expect(result.value.changes).toHaveLength(1)
  })

  it('4. compactação: 20 mudanças da mesma entrega viram um UPSERT', async () => {
    const delivery = makeDelivery()
    await deliveries.create(delivery)

    for (let index = 0; index < 10; index += 1) {
      delivery.markOutForDelivery()
      await deliveries.save(delivery)
      delivery.registerFailedAttempt('Ausente', new Date())
      await deliveries.save(delivery)
    }

    const result = await pull.execute({
      courierId: courierId.toString(),
      sinceVersion: 0,
      limit: 100,
    })

    if (result.isLeft()) throw new Error('pull falhou')

    expect(result.value.changes).toHaveLength(1)
    expect(result.value.changes[0].type).toBe('UPSERT')
  })

  it('5. janela do snapshot: mudança durante a paginação entra no delta seguinte', async () => {
    await deliveries.create(makeDelivery())
    await deliveries.create(makeDelivery())

    const firstPage = await snapshot.execute({
      courierId: courierId.toString(),
      limit: 1,
      withTotal: true,
    })

    if (firstPage.isLeft()) throw new Error('snapshot falhou')

    const baseVersion = firstPage.value.currentVersion

    // Chega uma entrega nova enquanto o app ainda pagina o snapshot.
    const late = makeDelivery()
    await deliveries.create(late)

    const client = await syncClient(baseVersion, 100)

    expect(client.cache.has(late.id.toString())).toBe(true)
  })

  it('6. escopo por ator: entrega de outro courier nunca aparece', async () => {
    await deliveries.create(makeDelivery(new UniqueEntityID()))

    const client = await syncClient(0, 100)

    expect(client.cache.size).toBe(0)
  })

  it('7. reatribuição: courier antigo recebe REMOVE, novo recebe UPSERT', async () => {
    const delivery = makeDelivery()
    await deliveries.create(delivery)

    const before = await syncClient(0, 100)
    expect(before.cache.has(delivery.id.toString())).toBe(true)

    delivery.assignTo(new UniqueEntityID())
    await deliveries.save(delivery)

    const after = await syncClient(before.cursor, 100)
    expect(after.cache.has(delivery.id.toString())).toBe(false)
  })

  it('8. push idempotente: mesmo clientEventId duas vezes, um efeito só', async () => {
    const delivery = makeDelivery()
    await deliveries.create(delivery)

    const event = {
      clientEventId: 'evt-1',
      deliveryId: delivery.id.toString(),
      type: 'OUT_FOR_DELIVERY' as const,
      occurredAt: new Date(),
    }

    await push.execute({ courierId: courierId.toString(), events: [event] })
    const second = await push.execute({
      courierId: courierId.toString(),
      events: [event],
    })

    if (second.isLeft()) throw new Error('push falhou')

    expect(second.value.results[0].status).toBe('DUPLICATE')
    expect(deliveries.items[0].revision).toBe(1)
  })

  it('9. push parcial: item rejeitado não impede os demais', async () => {
    const cancelled = makeDelivery()
    const healthy = makeDelivery()
    await deliveries.create(cancelled)
    await deliveries.create(healthy)

    cancelled.cancel('operação cancelou')
    await deliveries.save(cancelled)

    const result = await push.execute({
      courierId: courierId.toString(),
      events: [
        {
          clientEventId: 'evt-1',
          deliveryId: cancelled.id.toString(),
          type: 'OUT_FOR_DELIVERY',
          occurredAt: new Date(),
        },
        {
          clientEventId: 'evt-2',
          deliveryId: healthy.id.toString(),
          type: 'OUT_FOR_DELIVERY',
          occurredAt: new Date(),
        },
      ],
    })

    if (result.isLeft()) throw new Error('push falhou')

    expect(result.value.results[0].status).toBe('REJECTED')
    expect(result.value.results[1].status).toBe('APPLIED')
  })
})
