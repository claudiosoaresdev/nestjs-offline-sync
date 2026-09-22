import { beforeEach, describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvents } from '@/core/events/domain-events'
import { PullDeliveryChangesUseCase } from '@/domain/delivery/application/use-cases/pull-delivery-changes'
import { CustomerInfo } from '@/domain/delivery/enterprise/entities/customer-info'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'
import { InMemoryDeliveriesRepository } from '@/infrastructure/database/in-memory/in-memory-deliveries-repository'
import { InMemoryDeliveryChangesRepository } from '@/infrastructure/database/in-memory/in-memory-delivery-changes-repository'
import { InMemorySyncStateRepository } from '@/infrastructure/database/in-memory/in-memory-sync-state-repository'
import { AppendDeliveryChangeSubscriber } from '@/infrastructure/events/append-delivery-change.subscriber'

/** Duplo de teste: piso de retenção do log maior que zero, para exercitar o
 * branch de resync por cursor velho demais (código morto no in-memory real,
 * que nunca poda o log). */
class DeliveryChangesRepositoryWithFloor extends InMemoryDeliveryChangesRepository {
  minVersion(): Promise<number> {
    return Promise.resolve(3)
  }
}

let deliveries: InMemoryDeliveriesRepository
let changes: InMemoryDeliveryChangesRepository
let syncState: InMemorySyncStateRepository
let sut: PullDeliveryChangesUseCase

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

describe('PullDeliveryChangesUseCase', () => {
  beforeEach(() => {
    DomainEvents.clearHandlers()
    DomainEvents.clearMarkedAggregates()
    DomainEvents.shouldRun = true

    deliveries = new InMemoryDeliveriesRepository()
    syncState = new InMemorySyncStateRepository()
    changes = new InMemoryDeliveryChangesRepository(syncState)

    new AppendDeliveryChangeSubscriber(changes)

    sut = new PullDeliveryChangesUseCase(changes, deliveries, syncState)
  })

  it('devolve lote vazio quando o cliente já está em dia', async () => {
    await deliveries.create(makeDelivery())

    const result = await sut.execute({
      courierId: courierId.toString(),
      sinceVersion: 1,
      limit: 10,
    })

    if (result.isLeft()) throw new Error('pull falhou')

    expect(result.value.changes).toHaveLength(0)
    expect(result.value.hasMore).toBe(false)
    expect(result.value.nextVersion).toBe(1)
    expect(result.value.resyncRequired).toBe(false)
  })

  it('devolve UPSERT com a entrega inteira', async () => {
    const delivery = makeDelivery()
    await deliveries.create(delivery)

    const result = await sut.execute({
      courierId: courierId.toString(),
      sinceVersion: 0,
      limit: 10,
    })

    if (result.isLeft()) throw new Error('pull falhou')

    expect(result.value.changes).toHaveLength(1)
    expect(result.value.changes[0].type).toBe('UPSERT')
    expect(result.value.changes[0].delivery?.id.equals(delivery.id)).toBe(true)
  })

  it('sinaliza hasMore e devolve nextVersion do lote, não currentVersion', async () => {
    for (let index = 0; index < 5; index += 1) {
      await deliveries.create(makeDelivery())
    }

    const result = await sut.execute({
      courierId: courierId.toString(),
      sinceVersion: 0,
      limit: 2,
    })

    if (result.isLeft()) throw new Error('pull falhou')

    expect(result.value.nextVersion).toBe(2)
    expect(result.value.currentVersion).toBe(5)
    expect(result.value.hasMore).toBe(true)
  })

  it('compacta várias mudanças da mesma entrega em um UPSERT', async () => {
    const delivery = makeDelivery()
    await deliveries.create(delivery)

    delivery.markOutForDelivery(new Date())
    await deliveries.save(delivery)

    delivery.registerFailedAttempt('Ausente', new Date())
    await deliveries.save(delivery)

    const result = await sut.execute({
      courierId: courierId.toString(),
      sinceVersion: 0,
      limit: 10,
    })

    if (result.isLeft()) throw new Error('pull falhou')

    expect(result.value.changes).toHaveLength(1)
    expect(result.value.changes[0].version).toBe(3)
  })

  it('pede resync quando o cursor do cliente está adiantado', async () => {
    const result = await sut.execute({
      courierId: courierId.toString(),
      sinceVersion: 99,
      limit: 10,
    })

    if (result.isLeft()) throw new Error('pull falhou')

    expect(result.value.resyncRequired).toBe(true)
    expect(result.value.changes).toHaveLength(0)
  })

  it('degrada UPSERT para REMOVE quando a entrega saiu do escopo do courier', async () => {
    const delivery = makeDelivery()
    await deliveries.create(delivery)

    delivery.assignTo(new UniqueEntityID())
    await deliveries.save(delivery)

    const result = await sut.execute({
      courierId: courierId.toString(),
      sinceVersion: 0,
      limit: 10,
    })

    if (result.isLeft()) throw new Error('pull falhou')

    expect(result.value.changes).toHaveLength(1)
    expect(result.value.changes[0].type).toBe('REMOVE')
  })

  it('pede resync quando o cursor do cliente está abaixo do piso de retenção do log', async () => {
    const localSyncState = new InMemorySyncStateRepository()
    const localChanges = new DeliveryChangesRepositoryWithFloor(localSyncState)
    const localDeliveries = new InMemoryDeliveriesRepository()

    new AppendDeliveryChangeSubscriber(localChanges)

    const localSut = new PullDeliveryChangesUseCase(
      localChanges,
      localDeliveries,
      localSyncState,
    )

    await localDeliveries.create(makeDelivery())

    const result = await localSut.execute({
      courierId: courierId.toString(),
      sinceVersion: 1,
      limit: 10,
    })

    if (result.isLeft()) throw new Error('pull falhou')

    expect(result.value.resyncRequired).toBe(true)
    expect(result.value.changes).toHaveLength(0)
  })

  it('hasMore continua verdadeiro mesmo quando a compactação encolhe bastante o lote', async () => {
    const deliveryA = makeDelivery()
    await deliveries.create(deliveryA)
    await deliveries.create(makeDelivery())
    await deliveries.create(makeDelivery())

    for (let index = 0; index < 8; index += 1) {
      deliveryA.changeItems([])
      await deliveries.save(deliveryA)
    }

    const result = await sut.execute({
      courierId: courierId.toString(),
      sinceVersion: 0,
      limit: 10,
    })

    if (result.isLeft()) throw new Error('pull falhou')

    expect(result.value.hasMore).toBe(true)
    expect(result.value.changes.length).toBeLessThan(10)
  })

  it('degrada UPSERT para REMOVE quando a entrega foi cancelada antes de ser sincronizada', async () => {
    const delivery = makeDelivery()
    await deliveries.create(delivery)

    delivery.cancel('Cliente desistiu')
    await deliveries.save(delivery)

    // limit=1 devolve só a linha de criação (UPSERT); a linha de cancelamento
    // (REMOVE) fica fora do lote, mas o estado atual já está CANCELLED.
    const result = await sut.execute({
      courierId: courierId.toString(),
      sinceVersion: 0,
      limit: 1,
    })

    if (result.isLeft()) throw new Error('pull falhou')

    expect(result.value.changes).toHaveLength(1)
    expect(result.value.changes[0].type).toBe('REMOVE')
  })
})
