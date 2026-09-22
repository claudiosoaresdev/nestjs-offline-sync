import { beforeEach, describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvents } from '@/core/events/domain-events'
import { PushDeliveryEventsUseCase } from '@/domain/delivery/application/use-cases/push-delivery-events'
import { CustomerInfo } from '@/domain/delivery/enterprise/entities/customer-info'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'
import { InMemoryDeliveriesRepository } from '@/infrastructure/database/in-memory/in-memory-deliveries-repository'
import { InMemoryProcessedDeliveryEventsRepository } from '@/infrastructure/database/in-memory/in-memory-processed-delivery-events-repository'

let deliveries: InMemoryDeliveriesRepository
let processed: InMemoryProcessedDeliveryEventsRepository
let sut: PushDeliveryEventsUseCase

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

describe('PushDeliveryEventsUseCase', () => {
  beforeEach(() => {
    DomainEvents.clearHandlers()
    DomainEvents.clearMarkedAggregates()

    deliveries = new InMemoryDeliveriesRepository()
    processed = new InMemoryProcessedDeliveryEventsRepository()
    sut = new PushDeliveryEventsUseCase(deliveries, processed)
  })

  it('aplica saída e entrega na ordem de occurredAt', async () => {
    const delivery = makeDelivery()
    await deliveries.create(delivery)

    const result = await sut.execute({
      courierId: courierId.toString(),
      events: [
        {
          clientEventId: 'evt-2',
          deliveryId: delivery.id.toString(),
          type: 'DELIVERED',
          occurredAt: new Date('2026-09-21T12:10:00.000Z'),
          receivedBy: 'Porteiro',
        },
        {
          clientEventId: 'evt-1',
          deliveryId: delivery.id.toString(),
          type: 'OUT_FOR_DELIVERY',
          occurredAt: new Date('2026-09-21T12:00:00.000Z'),
        },
      ],
    })

    if (result.isLeft()) throw new Error('push falhou')

    expect(result.value.results.map((item) => item.status)).toEqual([
      'APPLIED',
      'APPLIED',
    ])
    expect(deliveries.items[0].status.value).toBe('DELIVERED')
  })

  it('marca DUPLICATE no reenvio do mesmo clientEventId', async () => {
    const delivery = makeDelivery()
    await deliveries.create(delivery)

    const event = {
      clientEventId: 'evt-1',
      deliveryId: delivery.id.toString(),
      type: 'OUT_FOR_DELIVERY' as const,
      occurredAt: new Date(),
    }

    await sut.execute({ courierId: courierId.toString(), events: [event] })
    const second = await sut.execute({
      courierId: courierId.toString(),
      events: [event],
    })

    if (second.isLeft()) throw new Error('push falhou')

    expect(second.value.results[0].status).toBe('DUPLICATE')
    expect(deliveries.items[0].status.value).toBe('OUT_FOR_DELIVERY')
  })

  it('rejeita transição inválida sem derrubar o resto do lote', async () => {
    const first = makeDelivery()
    const second = makeDelivery()
    await deliveries.create(first)
    await deliveries.create(second)

    const result = await sut.execute({
      courierId: courierId.toString(),
      events: [
        {
          clientEventId: 'evt-1',
          deliveryId: first.id.toString(),
          type: 'DELIVERED',
          occurredAt: new Date(),
          receivedBy: 'Maria',
        },
        {
          clientEventId: 'evt-2',
          deliveryId: second.id.toString(),
          type: 'OUT_FOR_DELIVERY',
          occurredAt: new Date(),
        },
      ],
    })

    if (result.isLeft()) throw new Error('push falhou')

    expect(result.value.results[0].status).toBe('REJECTED')
    expect(result.value.results[0].code).toBe('INVALID_STATUS_TRANSITION')
    expect(result.value.results[0].delivery?.id.equals(first.id)).toBe(true)
    expect(result.value.results[1].status).toBe('APPLIED')
  })

  it('rejeita entrega cancelada com código próprio', async () => {
    const delivery = makeDelivery()
    await deliveries.create(delivery)
    delivery.cancel('operação cancelou')
    await deliveries.save(delivery)

    const result = await sut.execute({
      courierId: courierId.toString(),
      events: [
        {
          clientEventId: 'evt-1',
          deliveryId: delivery.id.toString(),
          type: 'OUT_FOR_DELIVERY',
          occurredAt: new Date(),
        },
      ],
    })

    if (result.isLeft()) throw new Error('push falhou')

    expect(result.value.results[0].code).toBe('DELIVERY_CANCELLED')
  })

  it('rejeita evento de entrega que já é de outro courier', async () => {
    const delivery = makeDelivery(new UniqueEntityID())
    await deliveries.create(delivery)

    const result = await sut.execute({
      courierId: courierId.toString(),
      events: [
        {
          clientEventId: 'evt-1',
          deliveryId: delivery.id.toString(),
          type: 'OUT_FOR_DELIVERY',
          occurredAt: new Date(),
        },
      ],
    })

    if (result.isLeft()) throw new Error('push falhou')

    expect(result.value.results[0].code).toBe('DELIVERY_REASSIGNED')
  })

  it('rejeita evento de entrega inexistente', async () => {
    const result = await sut.execute({
      courierId: courierId.toString(),
      events: [
        {
          clientEventId: 'evt-1',
          deliveryId: new UniqueEntityID().toString(),
          type: 'OUT_FOR_DELIVERY',
          occurredAt: new Date(),
        },
      ],
    })

    if (result.isLeft()) throw new Error('push falhou')

    expect(result.value.results[0].code).toBe('DELIVERY_NOT_FOUND')
  })

  it('mantém resultado por posição quando o mesmo clientEventId se repete no lote', async () => {
    const delivery = makeDelivery()
    await deliveries.create(delivery)

    const result = await sut.execute({
      courierId: courierId.toString(),
      events: [
        {
          clientEventId: 'evt-1',
          deliveryId: delivery.id.toString(),
          type: 'OUT_FOR_DELIVERY',
          occurredAt: new Date('2026-09-21T12:00:00.000Z'),
        },
        {
          clientEventId: 'evt-1',
          deliveryId: delivery.id.toString(),
          type: 'OUT_FOR_DELIVERY',
          occurredAt: new Date('2026-09-21T12:05:00.000Z'),
        },
      ],
    })

    if (result.isLeft()) throw new Error('push falhou')

    expect(result.value.results.map((item) => item.status)).toEqual([
      'APPLIED',
      'DUPLICATE',
    ])
    expect(deliveries.items[0].revision).toBe(1)
  })

  it('aplica FAILED_ATTEMPT sem reason usando o default', async () => {
    const delivery = makeDelivery()
    delivery.markOutForDelivery(new Date('2026-09-21T11:00:00.000Z'))
    await deliveries.create(delivery)

    const result = await sut.execute({
      courierId: courierId.toString(),
      events: [
        {
          clientEventId: 'evt-1',
          deliveryId: delivery.id.toString(),
          type: 'FAILED_ATTEMPT',
          occurredAt: new Date(),
        },
      ],
    })

    if (result.isLeft()) throw new Error('push falhou')

    expect(result.value.results[0].status).toBe('APPLIED')
    expect(deliveries.items[0].lastFailureReason).toBe('Não informado')
  })

  it('devolve lista vazia para lote vazio', async () => {
    const result = await sut.execute({
      courierId: courierId.toString(),
      events: [],
    })

    if (result.isLeft()) throw new Error('push falhou')

    expect(result.value.results).toEqual([])
  })
})
