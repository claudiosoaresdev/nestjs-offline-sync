import { describe, expect, it } from 'vitest'

import { InvalidRatingScoreError } from '@/domain/delivery/application/use-cases/invalid-rating-score-error'
import { RatingScore } from '@/domain/delivery/enterprise/entities/rating-score'

describe('RatingScore', () => {
  it.each([0, 3, 5])('aceita a nota %i', (raw) => {
    const result = RatingScore.create(raw)

    expect(result.isRight()).toBe(true)
    expect(result.isRight() && result.value.value).toBe(raw)
  })

  it.each([-1, 6, 3.5, Number.NaN])('recusa a nota %s', (raw) => {
    const result = RatingScore.create(raw)

    expect(result.isLeft()).toBe(true)
    expect(result.value).toBeInstanceOf(InvalidRatingScoreError)
  })

  it('compara por valor', () => {
    const a = RatingScore.create(4)
    const b = RatingScore.create(4)

    expect(a.isRight() && b.isRight() && a.value.equals(b.value)).toBe(true)
  })
})
