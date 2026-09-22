import { beforeEach, describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { ResourceNotFoundError } from '@/core/errors/resource-not-found-error'
import { DomainEvents } from '@/core/events/domain-events'
import { CreateDeliveryUseCase } from '@/domain/delivery/application/use-cases/create-delivery'
import { InvalidQuantityError } from '@/domain/delivery/application/use-cases/errors/invalid-quantity-error'
import { Product } from '@/domain/delivery/enterprise/entities/product'
import { InMemoryDeliveriesRepository } from '@/infrastructure/database/in-memory/in-memory-deliveries-repository'
import { InMemoryProductsRepository } from '@/infrastructure/database/in-memory/in-memory-products-repository'

let deliveries: InMemoryDeliveriesRepository
let products: InMemoryProductsRepository
let sut: CreateDeliveryUseCase

const productId = new UniqueEntityID()
const customer = {
  name: 'Maria',
  phone: '11999999999',
  address: 'Rua A, 100',
}

describe('CreateDeliveryUseCase', () => {
  beforeEach(() => {
    DomainEvents.clearHandlers()
    DomainEvents.clearMarkedAggregates()

    deliveries = new InMemoryDeliveriesRepository()
    products = new InMemoryProductsRepository()
    products.items.push(
      Product.create({ name: 'Café', priceCents: 1990 }, productId),
    )

    sut = new CreateDeliveryUseCase(deliveries, products)
  })

  it('cria a entrega com snapshot de nome e preço do produto', async () => {
    const result = await sut.execute({
      courierId: new UniqueEntityID().toString(),
      customer,
      items: [{ productId: productId.toString(), quantity: 2 }],
    })

    expect(result.isRight()).toBe(true)
    if (result.isLeft()) return

    expect(result.value.delivery.items).toHaveLength(1)
    expect(result.value.delivery.items[0].productName).toBe('Café')
    expect(result.value.delivery.totalCents).toBe(3980)
    expect(deliveries.items).toHaveLength(1)
  })

  it('recusa produto inexistente', async () => {
    const result = await sut.execute({
      courierId: new UniqueEntityID().toString(),
      customer,
      items: [{ productId: new UniqueEntityID().toString(), quantity: 1 }],
    })

    expect(result.value).toBeInstanceOf(ResourceNotFoundError)
  })

  it('recusa quantidade inválida', async () => {
    const result = await sut.execute({
      courierId: new UniqueEntityID().toString(),
      customer,
      items: [{ productId: productId.toString(), quantity: 0 }],
    })

    expect(result.value).toBeInstanceOf(InvalidQuantityError)
  })
})
