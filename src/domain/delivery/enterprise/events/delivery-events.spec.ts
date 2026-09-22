import { describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DeliveryCancelledEvent } from '@/domain/delivery/enterprise/events/delivery-cancelled.event'
import { DeliveryCreatedEvent } from '@/domain/delivery/enterprise/events/delivery-created.event'
import { DeliveryDetailsChangedEvent } from '@/domain/delivery/enterprise/events/delivery-details-changed.event'
import { DeliveryRatedEvent } from '@/domain/delivery/enterprise/events/delivery-rated.event'
import { DeliveryStatusChangedEvent } from '@/domain/delivery/enterprise/events/delivery-status-changed.event'

describe('eventos de domínio da entrega', () => {
  it('DeliveryCreatedEvent aponta para a entrega, não para o courier', () => {
    const deliveryId = new UniqueEntityID()
    const courierId = new UniqueEntityID()

    const event = new DeliveryCreatedEvent(deliveryId, courierId)

    expect(event.getAggregateId().equals(deliveryId)).toBe(true)
    expect(event.courierId.equals(courierId)).toBe(true)
    expect(event.occurredAt).toBeInstanceOf(Date)
  })

  it('DeliveryStatusChangedEvent aponta para a entrega, não para o courier', () => {
    const deliveryId = new UniqueEntityID()
    const courierId = new UniqueEntityID()

    const event = new DeliveryStatusChangedEvent(
      deliveryId,
      courierId,
      'DELIVERED',
    )

    expect(event.getAggregateId().equals(deliveryId)).toBe(true)
    expect(event.courierId.equals(courierId)).toBe(true)
    expect(event.occurredAt).toBeInstanceOf(Date)
  })

  it('DeliveryDetailsChangedEvent aponta para a entrega, não para o courier', () => {
    const deliveryId = new UniqueEntityID()
    const courierId = new UniqueEntityID()

    const event = new DeliveryDetailsChangedEvent(deliveryId, courierId)

    expect(event.getAggregateId().equals(deliveryId)).toBe(true)
    expect(event.courierId.equals(courierId)).toBe(true)
    expect(event.occurredAt).toBeInstanceOf(Date)
  })

  it('DeliveryRatedEvent aponta para a entrega, não para o courier', () => {
    const deliveryId = new UniqueEntityID()
    const courierId = new UniqueEntityID()

    const event = new DeliveryRatedEvent(deliveryId, courierId, 5)

    expect(event.getAggregateId().equals(deliveryId)).toBe(true)
    expect(event.courierId.equals(courierId)).toBe(true)
    expect(event.occurredAt).toBeInstanceOf(Date)
  })

  it('DeliveryCancelledEvent aponta para a entrega, não para o courier', () => {
    const deliveryId = new UniqueEntityID()
    const courierId = new UniqueEntityID()

    const event = new DeliveryCancelledEvent(
      deliveryId,
      courierId,
      'Out of stock',
    )

    expect(event.getAggregateId().equals(deliveryId)).toBe(true)
    expect(event.courierId.equals(courierId)).toBe(true)
    expect(event.occurredAt).toBeInstanceOf(Date)
  })
})
