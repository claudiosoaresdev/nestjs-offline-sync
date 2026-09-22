import { beforeEach, describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvents } from '@/core/events/domain-events'
import { DeliveryAlreadyFinalizedError } from '@/domain/delivery/application/use-cases/errors/delivery-already-finalized-error'
import { DeliveryNotDeliveredError } from '@/domain/delivery/application/use-cases/errors/delivery-not-delivered-error'
import { InvalidStatusTransitionError } from '@/domain/delivery/application/use-cases/errors/invalid-status-transition-error'
import { RatingAlreadyExistsError } from '@/domain/delivery/application/use-cases/errors/rating-already-exists-error'
import { CustomerInfo } from '@/domain/delivery/enterprise/entities/customer-info'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'
import { DeliveryItem } from '@/domain/delivery/enterprise/entities/delivery-item'
import { Product } from '@/domain/delivery/enterprise/entities/product'
import { Quantity } from '@/domain/delivery/enterprise/entities/quantity'
import { RatingScore } from '@/domain/delivery/enterprise/entities/rating-score'
import { DeliveryAssignedEvent } from '@/domain/delivery/enterprise/events/delivery-assigned.event'
import { DeliveryCancelledEvent } from '@/domain/delivery/enterprise/events/delivery-cancelled.event'
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

    const result = delivery.markOutForDelivery(new Date())

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
    delivery.markOutForDelivery(new Date())

    const result = delivery.markDelivered('Porteiro', occurredAt)

    expect(result.isRight()).toBe(true)
    expect(delivery.status.value).toBe('DELIVERED')
    expect(delivery.receivedBy).toBe('Porteiro')
    expect(delivery.deliveredAt).toEqual(occurredAt)
  })

  it('tentativa falha incrementa attempts e volta para PENDING', () => {
    const delivery = makeDelivery()
    delivery.markOutForDelivery(new Date())

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
    expect(delivery.domainEvents[0]).toBeInstanceOf(DeliveryStatusChangedEvent)
    expect(delivery.domainEvents[1]).toBeInstanceOf(DeliveryCancelledEvent)
  })

  it('recusa cancelar entrega já entregue', () => {
    const delivery = makeDelivery()
    delivery.markOutForDelivery(new Date())
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

    delivery.markOutForDelivery(new Date())
    delivery.markDelivered('Maria', new Date())

    expect(delivery.revision).toBe(2)
  })

  it('recusa entregar duas vezes', () => {
    const delivery = makeDelivery()
    delivery.markOutForDelivery(new Date())
    delivery.markDelivered('Maria', new Date())

    const result = delivery.markDelivered('Outra pessoa', new Date())

    expect(result.isLeft()).toBe(true)
    expect(result.value).toBeInstanceOf(InvalidStatusTransitionError)
    expect(delivery.receivedBy).toBe('Maria')
  })

  it('recusa cancelar duas vezes', () => {
    const delivery = makeDelivery()
    delivery.cancel('Cliente desistiu')

    const result = delivery.cancel('de novo')

    expect(result.isLeft()).toBe(true)
    expect(result.value).toBeInstanceOf(InvalidStatusTransitionError)
    expect(delivery.cancelReason).toBe('Cliente desistiu')
  })

  it('recusa registrar tentativa falha duas vezes seguidas sem sair para entrega de novo', () => {
    const delivery = makeDelivery()
    delivery.markOutForDelivery(new Date())
    delivery.registerFailedAttempt('Ausente', new Date())

    const result = delivery.registerFailedAttempt('Ausente de novo', new Date())

    expect(result.isLeft()).toBe(true)
    expect(result.value).toBeInstanceOf(InvalidStatusTransitionError)
    expect(delivery.attempts).toBe(1)
    expect(delivery.lastFailureReason).toBe('Ausente')
  })

  it('recusa cancelar após entregar, avaliar e não perde a avaliação', () => {
    const delivery = makeDelivery()
    delivery.markOutForDelivery(new Date())
    delivery.markDelivered('Maria', new Date())

    const score = RatingScore.create(5)
    if (score.isLeft()) throw new Error('score inválido no setup')
    delivery.rate(score.value, 'Ótimo')

    const result = delivery.cancel('tarde demais')

    expect(result.isLeft()).toBe(true)
    expect(result.value).toBeInstanceOf(InvalidStatusTransitionError)
    expect(delivery.rating?.score.value).toBe(5)
    expect(delivery.rating?.comment).toBe('Ótimo')
  })

  it('permite reatribuir entrega em trânsito, mantendo o status', () => {
    const previous = new UniqueEntityID()
    const next = new UniqueEntityID()
    const delivery = makeDelivery(previous)
    delivery.markOutForDelivery(new Date())
    delivery.clearEvents()

    const result = delivery.assignTo(next)

    expect(result.isRight()).toBe(true)
    expect(delivery.status.value).toBe('OUT_FOR_DELIVERY')
    expect(delivery.courierId.equals(next)).toBe(true)

    const event = delivery.domainEvents[0] as DeliveryAssignedEvent
    expect(event).toBeInstanceOf(DeliveryAssignedEvent)
    expect(event.previousCourierId?.equals(previous)).toBe(true)
  })
})

describe('Delivery — detalhes e avaliação', () => {
  beforeEach(() => {
    DomainEvents.clearHandlers()
    DomainEvents.clearMarkedAggregates()
  })

  it('troca os itens enquanto a entrega não terminou', () => {
    const delivery = makeDelivery()

    const result = delivery.changeItems([makeItem(), makeItem()])

    expect(result.isRight()).toBe(true)
    expect(delivery.items).toHaveLength(2)
    expect(delivery.totalCents).toBe(3980)
  })

  it('troca os dados do cliente', () => {
    const delivery = makeDelivery()

    const result = delivery.changeCustomer(
      CustomerInfo.create({
        name: 'Maria',
        phone: '11999999999',
        address: 'Rua Nova, 500',
      }),
    )

    expect(result.isRight()).toBe(true)
    expect(delivery.customer.address).toBe('Rua Nova, 500')
  })

  it('recusa alterar itens de entrega finalizada', () => {
    const delivery = makeDelivery()
    delivery.markOutForDelivery(new Date())
    delivery.markDelivered('Maria', new Date())

    const result = delivery.changeItems([makeItem()])

    expect(result.isLeft()).toBe(true)
    expect(result.value).toBeInstanceOf(DeliveryAlreadyFinalizedError)
  })

  it('avalia entrega entregue', () => {
    const delivery = makeDelivery()
    delivery.markOutForDelivery(new Date())
    delivery.markDelivered('Maria', new Date())

    const score = RatingScore.create(5)
    if (score.isLeft()) throw new Error('score inválido no setup')

    const result = delivery.rate(score.value, 'Rápido')

    expect(result.isRight()).toBe(true)
    expect(delivery.rating?.score.value).toBe(5)
    expect(delivery.rating?.comment).toBe('Rápido')
  })

  it('recusa avaliar entrega não entregue', () => {
    const delivery = makeDelivery()
    const score = RatingScore.create(5)
    if (score.isLeft()) throw new Error('score inválido no setup')

    const result = delivery.rate(score.value, null)

    expect(result.isLeft()).toBe(true)
    expect(result.value).toBeInstanceOf(DeliveryNotDeliveredError)
  })

  it('recusa avaliar duas vezes', () => {
    const delivery = makeDelivery()
    delivery.markOutForDelivery(new Date())
    delivery.markDelivered('Maria', new Date())

    const score = RatingScore.create(4)
    if (score.isLeft()) throw new Error('score inválido no setup')

    delivery.rate(score.value, null)
    const result = delivery.rate(score.value, null)

    expect(result.isLeft()).toBe(true)
    expect(result.value).toBeInstanceOf(RatingAlreadyExistsError)
  })

  it('não permite mutar o estado interno via a referência devolvida por items', () => {
    const delivery = makeDelivery()

    const leaked = delivery.items as DeliveryItem[]
    leaked.push(makeItem())

    expect(delivery.items).toHaveLength(1)
  })

  it('não permite mutar o estado interno via a referência devolvida por rating', () => {
    const delivery = makeDelivery()
    delivery.markOutForDelivery(new Date())
    delivery.markDelivered('Maria', new Date())

    const score = RatingScore.create(5)
    if (score.isLeft()) throw new Error('score inválido no setup')
    delivery.rate(score.value, 'Rápido')

    const leaked = delivery.rating
    if (!leaked) throw new Error('rating ausente no setup')
    leaked.comment = 'Adulterado'

    expect(delivery.rating?.comment).toBe('Rápido')
  })
})
