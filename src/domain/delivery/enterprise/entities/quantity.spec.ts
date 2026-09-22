import { describe, expect, it } from 'vitest'

import { InvalidQuantityError } from '@/domain/delivery/application/use-cases/errors/invalid-quantity-error'
import { Quantity } from '@/domain/delivery/enterprise/entities/quantity'

describe('Quantity', () => {
  it('aceita inteiro positivo', () => {
    const result = Quantity.create(2)

    expect(result.isRight() && result.value.value).toBe(2)
  })

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])('recusa %s', (raw) => {
    const result = Quantity.create(raw)

    expect(result.isLeft()).toBe(true)
    expect(result.value).toBeInstanceOf(InvalidQuantityError)
  })
})
