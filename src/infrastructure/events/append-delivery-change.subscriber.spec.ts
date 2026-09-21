import { beforeEach, describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvents } from '@/core/events/domain-events'
import { CustomerInfo } from '@/domain/delivery/enterprise/entities/customer-info'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'
import { RatingScore } from '@/domain/delivery/enterprise/entities/rating-score'
import { InMemoryDeliveriesRepository } from '@/infrastructure/database/in-memory/in-memory-deliveries-repository'
import { InMemoryDeliveryChangesRepository } from '@/infrastructure/database/in-memory/in-memory-delivery-changes-repository'
import { InMemorySyncStateRepository } from '@/infrastructure/database/in-memory/in-memory-sync-state-repository'
import { AppendDeliveryChangeSubscriber } from '@/infrastructure/events/append-delivery-change.subscriber'

let deliveries: InMemoryDeliveriesRepository
let changes: InMemoryDeliveryChangesRepository

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

describe('AppendDeliveryChangeSubscriber', () => {
  beforeEach(() => {
    DomainEvents.clearHandlers()
    DomainEvents.clearMarkedAggregates()
    DomainEvents.shouldRun = true

    deliveries = new InMemoryDeliveriesRepository()
    changes = new InMemoryDeliveryChangesRepository(
      new InMemorySyncStateRepository(),
    )

    new AppendDeliveryChangeSubscriber(changes)
  })

  it('cria a entrega gera um UPSERT para o courier', async () => {
    const delivery = makeDelivery()

    await deliveries.create(delivery)

    expect(changes.items).toHaveLength(1)
    expect(changes.items[0].type).toBe('UPSERT')
    expect(changes.items[0].courierId.equals(courierId)).toBe(true)
  })

  it('mudança de status gera UPSERT', async () => {
    const delivery = makeDelivery()
    await deliveries.create(delivery)

    delivery.markOutForDelivery()
    await deliveries.save(delivery)

    expect(changes.items).toHaveLength(2)
    expect(changes.items[1].type).toBe('UPSERT')
  })

  it('reatribuição gera REMOVE para o antigo e UPSERT para o novo', async () => {
    const delivery = makeDelivery()
    await deliveries.create(delivery)

    const newCourierId = new UniqueEntityID()
    delivery.assignTo(newCourierId)
    await deliveries.save(delivery)

    const [, remove, upsert] = changes.items
    expect(remove.type).toBe('REMOVE')
    expect(remove.courierId.equals(courierId)).toBe(true)
    expect(upsert.type).toBe('UPSERT')
    expect(upsert.courierId.equals(newCourierId)).toBe(true)
  })

  it('cancelamento termina com REMOVE', async () => {
    const delivery = makeDelivery()
    await deliveries.create(delivery)

    delivery.cancel('cliente desistiu')
    await deliveries.save(delivery)

    expect(changes.items[changes.items.length - 1].type).toBe('REMOVE')
  })

  it('avaliação gera UPSERT', async () => {
    const delivery = makeDelivery()
    await deliveries.create(delivery)

    delivery.markOutForDelivery()
    await deliveries.save(delivery)

    delivery.markDelivered('Maria', new Date())
    await deliveries.save(delivery)

    const score = RatingScore.create(5)
    if (score.isLeft()) throw new Error('score inválido no setup')
    delivery.rate(score.value, 'Ótimo')
    await deliveries.save(delivery)

    const last = changes.items[changes.items.length - 1]
    expect(last.type).toBe('UPSERT')
    expect(last.courierId.equals(courierId)).toBe(true)
  })

  it('alteração de detalhes gera UPSERT', async () => {
    const delivery = makeDelivery()
    await deliveries.create(delivery)

    delivery.changeCustomer(
      CustomerInfo.create({
        name: 'João',
        phone: '11988888888',
        address: 'Rua B, 200',
      }),
    )
    await deliveries.save(delivery)

    const last = changes.items[changes.items.length - 1]
    expect(last.type).toBe('UPSERT')
    expect(last.courierId.equals(courierId)).toBe(true)
  })
})
