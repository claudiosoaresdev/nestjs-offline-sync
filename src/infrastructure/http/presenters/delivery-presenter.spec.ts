import { describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { CustomerInfo } from '@/domain/delivery/enterprise/entities/customer-info'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'
import { DeliveryItem } from '@/domain/delivery/enterprise/entities/delivery-item'
import { Product } from '@/domain/delivery/enterprise/entities/product'
import { Quantity } from '@/domain/delivery/enterprise/entities/quantity'
import { RatingScore } from '@/domain/delivery/enterprise/entities/rating-score'
import { DeliveryPresenter } from '@/infrastructure/http/presenters/delivery-presenter'

function makeDelivery(): Delivery {
  const quantity = Quantity.create(2)
  if (quantity.isLeft()) throw new Error('quantity inválida no setup')

  return Delivery.create({
    courierId: new UniqueEntityID(),
    customer: CustomerInfo.create({
      name: 'Maria',
      phone: '11999999999',
      address: 'Rua A, 100',
    }),
    items: [
      DeliveryItem.fromProduct(
        Product.create({ name: 'Café', priceCents: 1990 }),
        quantity.value,
      ),
    ],
  })
}

describe('DeliveryPresenter', () => {
  it('serializa a entrega sem vazar objetos de domínio', () => {
    const http = DeliveryPresenter.toHTTP(makeDelivery())

    expect(http.status).toBe('PENDING')
    expect(http.items[0]).toEqual({
      productId: expect.any(String) as string,
      productName: 'Café',
      unitPriceCents: 1990,
      quantity: 2,
    })
    expect(http.totalCents).toBe(3980)
    expect(http.rating).toBeNull()
    expect(typeof http.createdAt).toBe('string')
  })

  it('serializa a avaliação quando existe', () => {
    const delivery = makeDelivery()
    delivery.markOutForDelivery()
    delivery.markDelivered('Maria', new Date())

    const score = RatingScore.create(4)
    if (score.isLeft()) throw new Error('score inválido no setup')

    delivery.rate(score.value, 'Bom')

    const http = DeliveryPresenter.toHTTP(delivery)

    expect(http.rating).toEqual({
      score: 4,
      comment: 'Bom',
      ratedAt: expect.any(String) as string,
    })
  })
})
