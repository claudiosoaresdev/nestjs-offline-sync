import { describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DeliveryAssignedEvent } from '@/domain/delivery/enterprise/events/delivery-assigned.event'

describe('DeliveryAssignedEvent', () => {
  it('aponta para a entrega e carrega os dois couriers', () => {
    const deliveryId = new UniqueEntityID()
    const previous = new UniqueEntityID()
    const next = new UniqueEntityID()

    const event = new DeliveryAssignedEvent(deliveryId, next, previous)

    expect(event.getAggregateId().equals(deliveryId)).toBe(true)
    expect(event.courierId.equals(next)).toBe(true)
    expect(event.previousCourierId?.equals(previous)).toBe(true)
    expect(event.occurredAt).toBeInstanceOf(Date)
  })

  it('aceita ausência de courier anterior na primeira atribuição', () => {
    const event = new DeliveryAssignedEvent(
      new UniqueEntityID(),
      new UniqueEntityID(),
      null,
    )

    expect(event.previousCourierId).toBeNull()
  })
})
