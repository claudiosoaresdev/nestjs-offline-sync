import { describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DeliveryItem } from '@/domain/delivery/enterprise/entities/delivery-item'
import { Product } from '@/domain/delivery/enterprise/entities/product'
import { Quantity } from '@/domain/delivery/enterprise/entities/quantity'

describe('DeliveryItem', () => {
  it('congela nome e preço do produto no momento da criação', () => {
    const productId = new UniqueEntityID()
    const product = Product.create(
      { name: 'Café', priceCents: 1990 },
      productId,
    )
    const quantity = Quantity.create(2)

    if (quantity.isLeft()) throw new Error('quantity inválida no setup')

    const item = DeliveryItem.fromProduct(product, quantity.value)

    expect(item.productId.equals(productId)).toBe(true)
    expect(item.productName).toBe('Café')
    expect(item.unitPriceCents).toBe(1990)
    expect(item.quantity.value).toBe(2)
  })

  it('calcula o subtotal', () => {
    const product = Product.create({ name: 'Café', priceCents: 1990 })
    const quantity = Quantity.create(3)

    if (quantity.isLeft()) throw new Error('quantity inválida no setup')

    expect(
      DeliveryItem.fromProduct(product, quantity.value).subtotalCents,
    ).toBe(5970)
  })
})
