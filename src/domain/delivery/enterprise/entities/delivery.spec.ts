import { beforeEach, describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvents } from '@/core/events/domain-events'
import { DeliveryAlreadyFinalizedError } from '@/domain/delivery/application/use-cases/delivery-already-finalized-error'
import { InvalidStatusTransitionError } from '@/domain/delivery/application/use-cases/invalid-status-transition-error'
import { CustomerInfo } from '@/domain/delivery/enterprise/entities/customer-info'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'
import { DeliveryItem } from '@/domain/delivery/enterprise/entities/delivery-item'
import { Product } from '@/domain/delivery/enterprise/entities/product'
import { Quantity } from '@/domain/delivery/enterprise/entities/quantity'
import { DeliveryAssignedEvent } from '@/domain/delivery/enterprise/events/delivery-assigned.event'
import { DeliveryStatusChangedEvent } from '@/domain/delivery/enterprise/events/delivery-status-changed.event'

function makeItem(): DeliveryItem {
  const quantity = Quantity.create(1)

  if (quantity.isLeft()) throw new Error('quantity inválida no setup')

  return DeliveryItem.fromProduct(
    Product.create({ name: 'Café', priceCents: 1990 }),
    quantity.value,
  )
}

function makeDelivery(courierId = new UniqueEntityID()): Delivery {
  const delivery = Delivery.create({
    courierId,
    customer: CustomerInfo.create({
      name: 'Maria',
      phone: '11999999999',
      address: 'Rua A, 100',
    }),
    items: [makeItem()],
  })

  // Descarta o DeliveryCreatedEvent para que as contagens abaixo enxerguem
  // só os eventos da ação sob teste.
  delivery.clearEvents()

  return delivery
}

describe('Delivery — criação e transições', () => {
  beforeEach(() => {
    DomainEvents.clearHandlers()
    DomainEvents.clearMarkedAggregates()
  })

  it('nasce em PENDING, sem tentativas e sem avaliação', () => {
    const delivery = makeDelivery()

    expect(delivery.status.value).toBe('PENDING')
    expect(delivery.attempts).toBe(0)
    expect(delivery.rating).toBeNull()
    expect(delivery.revision).toBe(0)
  })

  it('calcula o total a partir dos itens', () => {
    expect(makeDelivery().totalCents).toBe(1990)
  })

  it('sai para entrega e emite evento de status', () => {
    const delivery = makeDelivery()

    const result = delivery.markOutForDelivery()

    expect(result.isRight()).toBe(true)
    expect(delivery.status.value).toBe('OUT_FOR_DELIVERY')
    expect(delivery.domainEvents).toHaveLength(1)
    expect(delivery.domainEvents[0]).toBeInstanceOf(DeliveryStatusChangedEvent)
  })

  it('recusa entregar sem ter saído para entrega', () => {
    const delivery = makeDelivery()

    const result = delivery.markDelivered('Maria', new Date())

    expect(result.isLeft()).toBe(true)
    expect(result.value).toBeInstanceOf(InvalidStatusTransitionError)
    expect(delivery.status.value).toBe('PENDING')
  })

  it('entrega registrando quem recebeu', () => {
    const delivery = makeDelivery()
    const occurredAt = new Date('2026-09-21T12:00:00.000Z')
    delivery.markOutForDelivery()

    const result = delivery.markDelivered('Porteiro', occurredAt)

    expect(result.isRight()).toBe(true)
    expect(delivery.status.value).toBe('DELIVERED')
    expect(delivery.receivedBy).toBe('Porteiro')
    expect(delivery.deliveredAt).toEqual(occurredAt)
  })

  it('tentativa falha incrementa attempts e volta para PENDING', () => {
    const delivery = makeDelivery()
    delivery.markOutForDelivery()

    const result = delivery.registerFailedAttempt(
      'Ausente',
      new Date('2026-09-21T12:00:00.000Z'),
    )

    expect(result.isRight()).toBe(true)
    expect(delivery.status.value).toBe('PENDING')
    expect(delivery.attempts).toBe(1)
    expect(delivery.lastFailureReason).toBe('Ausente')
  })

  it('cancela e emite status changed seguido de cancelled', () => {
    const delivery = makeDelivery()

    const result = delivery.cancel('Cliente desistiu')

    expect(result.isRight()).toBe(true)
    expect(delivery.status.value).toBe('CANCELLED')
    expect(delivery.domainEvents).toHaveLength(2)
  })

  it('recusa cancelar entrega já entregue', () => {
    const delivery = makeDelivery()
    delivery.markOutForDelivery()
    delivery.markDelivered('Maria', new Date())

    const result = delivery.cancel('tarde demais')

    expect(result.isLeft()).toBe(true)
    expect(result.value).toBeInstanceOf(InvalidStatusTransitionError)
  })

  it('reatribui carregando o courier anterior no evento', () => {
    const previous = new UniqueEntityID()
    const next = new UniqueEntityID()
    const delivery = makeDelivery(previous)

    const result = delivery.assignTo(next)

    expect(result.isRight()).toBe(true)
    expect(delivery.courierId.equals(next)).toBe(true)

    const event = delivery.domainEvents[0] as DeliveryAssignedEvent
    expect(event).toBeInstanceOf(DeliveryAssignedEvent)
    expect(event.previousCourierId?.equals(previous)).toBe(true)
  })

  it('reatribuir para o mesmo courier não emite evento', () => {
    const courierId = new UniqueEntityID()
    const delivery = makeDelivery(courierId)

    delivery.assignTo(courierId)

    expect(delivery.domainEvents).toHaveLength(0)
  })

  it('recusa reatribuir entrega finalizada', () => {
    const delivery = makeDelivery()
    delivery.cancel('desistiu')

    const result = delivery.assignTo(new UniqueEntityID())

    expect(result.isLeft()).toBe(true)
    expect(result.value).toBeInstanceOf(DeliveryAlreadyFinalizedError)
  })

  it('incrementa revision a cada mudança', () => {
    const delivery = makeDelivery()

    delivery.markOutForDelivery()
    delivery.markDelivered('Maria', new Date())

    expect(delivery.revision).toBe(2)
  })
})
