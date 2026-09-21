import { beforeEach, describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvents } from '@/core/events/domain-events'
import { GetDeliverySnapshotUseCase } from '@/domain/delivery/application/use-cases/get-delivery-snapshot'
import { CustomerInfo } from '@/domain/delivery/enterprise/entities/customer-info'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'
import { InMemoryDeliveriesRepository } from '@/infrastructure/database/in-memory/in-memory-deliveries-repository'
import { InMemorySyncStateRepository } from '@/infrastructure/database/in-memory/in-memory-sync-state-repository'

let deliveries: InMemoryDeliveriesRepository
let syncState: InMemorySyncStateRepository
let sut: GetDeliverySnapshotUseCase

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

describe('GetDeliverySnapshotUseCase', () => {
  beforeEach(() => {
    DomainEvents.clearHandlers()
    DomainEvents.clearMarkedAggregates()

    deliveries = new InMemoryDeliveriesRepository()
    syncState = new InMemorySyncStateRepository()
    sut = new GetDeliverySnapshotUseCase(deliveries, syncState)
  })

  it('devolve a página e a versão âncora', async () => {
    await deliveries.create(makeDelivery())
    await deliveries.create(makeDelivery())

    const result = await sut.execute({
      courierId: courierId.toString(),
      limit: 10,
      withTotal: true,
    })

    expect(result.isRight()).toBe(true)
    if (result.isLeft()) return

    expect(result.value.deliveries).toHaveLength(2)
    expect(result.value.totalItems).toBe(2)
    expect(result.value.nextCursor).toBeUndefined()
    expect(result.value.currentVersion).toBe(0)
  })

  it('pagina por cursor', async () => {
    await deliveries.create(makeDelivery())
    await deliveries.create(makeDelivery())
    await deliveries.create(makeDelivery())

    const first = await sut.execute({
      courierId: courierId.toString(),
      limit: 2,
      withTotal: false,
    })

    if (first.isLeft()) throw new Error('snapshot falhou')

    expect(first.value.deliveries).toHaveLength(2)
    expect(first.value.nextCursor).toBeDefined()
    expect(first.value.totalItems).toBeUndefined()

    const second = await sut.execute({
      courierId: courierId.toString(),
      limit: 2,
      withTotal: false,
      cursor: first.value.nextCursor,
    })

    if (second.isLeft()) throw new Error('snapshot falhou')

    expect(second.value.deliveries).toHaveLength(1)
    expect(second.value.nextCursor).toBeUndefined()
  })

  it('não devolve entrega de outro courier', async () => {
    await deliveries.create(makeDelivery(new UniqueEntityID()))

    const result = await sut.execute({
      courierId: courierId.toString(),
      limit: 10,
      withTotal: false,
    })

    if (result.isLeft()) throw new Error('snapshot falhou')

    expect(result.value.deliveries).toHaveLength(0)
  })
})
