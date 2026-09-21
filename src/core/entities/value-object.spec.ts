import { describe, expect, it } from 'vitest'

import { ValueObject } from '@/core/entities/value-object'

class Dummy extends ValueObject<{ amount: number; currency: string }> {
  static create(amount: number, currency: string) {
    return new Dummy({ amount, currency })
  }
}

describe('ValueObject', () => {
  it('compara por valor, não por referência', () => {
    expect(Dummy.create(10, 'BRL').equals(Dummy.create(10, 'BRL'))).toBe(true)
  })

  it('difere quando qualquer parte do valor difere', () => {
    expect(Dummy.create(10, 'BRL').equals(Dummy.create(10, 'USD'))).toBe(false)
  })
})
