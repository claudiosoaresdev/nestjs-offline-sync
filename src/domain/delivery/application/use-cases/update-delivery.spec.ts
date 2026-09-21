import { beforeEach, describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvents } from '@/core/events/domain-events'
import { DeliveryAlreadyFinalizedError } from '@/domain/delivery/application/use-cases/delivery-already-finalized-error'
import { DeliveryNotFoundError } from '@/domain/delivery/application/use-cases/delivery-not-found-error'
import { UpdateDeliveryUseCase } from '@/domain/delivery/application/use-cases/update-delivery'
import { CustomerInfo } from '@/domain/delivery/enterprise/entities/customer-info'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'
import { Product } from '@/domain/delivery/enterprise/entities/product'
import { InMemoryDeliveriesRepository } from '@/infrastructure/database/in-memory/in-memory-deliveries-repository'
import { InMemoryProductsRepository } from '@/infrastructure/database/in-memory/in-memory-products-repository'

let deliveries: InMemoryDeliveriesRepository
let products: InMemoryProductsRepository
let sut: UpdateDeliveryUseCase

const productId = new UniqueEntityID()

async function makeDelivery(): Promise<Delivery> {
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

  return delivery
}

describe('UpdateDeliveryUseCase', () => {
  beforeEach(() => {
    DomainEvents.clearHandlers()
    DomainEvents.clearMarkedAggregates()

    deliveries = new InMemoryDeliveriesRepository()
    products = new InMemoryProductsRepository()
    products.items.push(
      Product.create({ name: 'Café', priceCents: 1990 }, productId),
    )

    sut = new UpdateDeliveryUseCase(deliveries, products)
  })

  it('troca os dados do cliente', async () => {
    const delivery = await makeDelivery()

    const result = await sut.execute({
      deliveryId: delivery.id.toString(),
      customer: {
        name: 'Maria',
        phone: '11999999999',
        address: 'Rua Nova, 500',
      },
    })

    expect(result.isRight()).toBe(true)
    expect(deliveries.items[0].customer.address).toBe('Rua Nova, 500')
  })

  it('troca os itens', async () => {
    const delivery = await makeDelivery()

    const result = await sut.execute({
      deliveryId: delivery.id.toString(),
      items: [{ productId: productId.toString(), quantity: 3 }],
    })

    expect(result.isRight()).toBe(true)
    expect(deliveries.items[0].totalCents).toBe(5970)
  })

  it('reatribui para outro courier', async () => {
    const delivery = await makeDelivery()
    const newCourierId = new UniqueEntityID().toString()

    const result = await sut.execute({
      deliveryId: delivery.id.toString(),
      courierId: newCourierId,
    })

    expect(result.isRight()).toBe(true)
    expect(deliveries.items[0].courierId.toString()).toBe(newCourierId)
  })

  it('cancela a entrega', async () => {
    const delivery = await makeDelivery()

    const result = await sut.execute({
      deliveryId: delivery.id.toString(),
      cancelReason: 'cliente desistiu',
    })

    expect(result.isRight()).toBe(true)
    expect(deliveries.items[0].status.value).toBe('CANCELLED')
  })

  it('recusa alterar entrega finalizada', async () => {
    const delivery = await makeDelivery()
    delivery.cancel('já era')
    await deliveries.save(delivery)

    const result = await sut.execute({
      deliveryId: delivery.id.toString(),
      items: [{ productId: productId.toString(), quantity: 1 }],
    })

    expect(result.value).toBeInstanceOf(DeliveryAlreadyFinalizedError)
  })

  it('recusa entrega inexistente', async () => {
    const result = await sut.execute({
      deliveryId: new UniqueEntityID().toString(),
      cancelReason: 'nada',
    })

    expect(result.value).toBeInstanceOf(DeliveryNotFoundError)
  })
})
