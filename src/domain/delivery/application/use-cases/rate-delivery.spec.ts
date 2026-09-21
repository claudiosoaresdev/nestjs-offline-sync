import { beforeEach, describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvents } from '@/core/events/domain-events'
import { DeliveryNotDeliveredError } from '@/domain/delivery/application/use-cases/errors/delivery-not-delivered-error'
import { DeliveryNotFoundError } from '@/domain/delivery/application/use-cases/errors/delivery-not-found-error'
import { InvalidRatingScoreError } from '@/domain/delivery/application/use-cases/errors/invalid-rating-score-error'
import { RatingAlreadyExistsError } from '@/domain/delivery/application/use-cases/errors/rating-already-exists-error'
import { RateDeliveryUseCase } from '@/domain/delivery/application/use-cases/rate-delivery'
import { CustomerInfo } from '@/domain/delivery/enterprise/entities/customer-info'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'
import { InMemoryDeliveriesRepository } from '@/infrastructure/database/in-memory/in-memory-deliveries-repository'

let deliveries: InMemoryDeliveriesRepository
let sut: RateDeliveryUseCase

async function makeDeliveredDelivery(): Promise<Delivery> {
  const delivery = Delivery.create({
    courierId: new UniqueEntityID(),
    customer: CustomerInfo.create({
      name: 'Maria',
      phone: '11999999999',
      address: 'Rua A, 100',
    }),
    items: [],
  })

  delivery.markOutForDelivery()
  delivery.markDelivered('Maria', new Date())
  await deliveries.create(delivery)

  return delivery
}

describe('RateDeliveryUseCase', () => {
  beforeEach(() => {
    DomainEvents.clearHandlers()
    DomainEvents.clearMarkedAggregates()

    deliveries = new InMemoryDeliveriesRepository()
    sut = new RateDeliveryUseCase(deliveries)
  })

  it('avalia entrega entregue', async () => {
    const delivery = await makeDeliveredDelivery()

    const result = await sut.execute({
      deliveryId: delivery.id.toString(),
      score: 5,
      comment: 'Rápido',
    })

    expect(result.isRight()).toBe(true)
    expect(deliveries.items[0].rating?.score.value).toBe(5)
    expect(deliveries.items[0].rating?.comment).toBe('Rápido')
  })

  it('aceita nota sem comentário', async () => {
    const delivery = await makeDeliveredDelivery()

    const result = await sut.execute({
      deliveryId: delivery.id.toString(),
      score: 0,
      comment: null,
    })

    expect(result.isRight()).toBe(true)
    expect(deliveries.items[0].rating?.comment).toBeNull()
  })

  it('recusa nota fora da faixa', async () => {
    const delivery = await makeDeliveredDelivery()

    const result = await sut.execute({
      deliveryId: delivery.id.toString(),
      score: 9,
      comment: null,
    })

    expect(result.isLeft()).toBe(true)
    expect(result.value).toBeInstanceOf(InvalidRatingScoreError)
  })

  it('recusa entrega inexistente', async () => {
    const result = await sut.execute({
      deliveryId: new UniqueEntityID().toString(),
      score: 5,
      comment: null,
    })

    expect(result.value).toBeInstanceOf(DeliveryNotFoundError)
  })

  it('recusa entrega que ainda não foi entregue', async () => {
    const delivery = Delivery.create({
      courierId: new UniqueEntityID(),
      customer: CustomerInfo.create({
        name: 'Maria',
        phone: '11999999999',
        address: 'Rua A, 100',
      }),
      items: [],
    })
    await deliveries.create(delivery)

    const result = await sut.execute({
      deliveryId: delivery.id.toString(),
      score: 5,
      comment: null,
    })

    expect(result.value).toBeInstanceOf(DeliveryNotDeliveredError)
  })

  it('recusa avaliar duas vezes', async () => {
    const delivery = await makeDeliveredDelivery()

    await sut.execute({
      deliveryId: delivery.id.toString(),
      score: 5,
      comment: null,
    })
    const result = await sut.execute({
      deliveryId: delivery.id.toString(),
      score: 4,
      comment: null,
    })

    expect(result.value).toBeInstanceOf(RatingAlreadyExistsError)
  })
})
