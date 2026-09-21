import { describe, expect, it } from 'vitest'

import { Either, left, right } from '@/core/either'

function doubleOrFail(value: number): Either<string, number> {
  return value < 0 ? left('negative') : right(value * 2)
}

describe('Either', () => {
  it('estreita para Right no caminho de sucesso', () => {
    const result = doubleOrFail(2)

    expect(result.isRight()).toBe(true)
    expect(result.isLeft()).toBe(false)
    expect(result.isRight() && result.value).toBe(4)
  })

  it('estreita para Left no caminho de erro', () => {
    const result = doubleOrFail(-1)

    expect(result.isLeft()).toBe(true)
    expect(result.isLeft() && result.value).toBe('negative')
  })
})
