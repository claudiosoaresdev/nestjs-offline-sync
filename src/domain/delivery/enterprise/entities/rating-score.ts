import { Either, left, right } from '@/core/either'
import { ValueObject } from '@/core/entities/value-object'
import { InvalidRatingScoreError } from '@/domain/delivery/application/use-cases/invalid-rating-score-error'

const MIN_SCORE = 0
const MAX_SCORE = 5

interface RatingScoreProps {
  value: number
}

export class RatingScore extends ValueObject<RatingScoreProps> {
  private constructor(props: RatingScoreProps) {
    super(props)
  }

  get value(): number {
    return this.props.value
  }

  static create(raw: number): Either<InvalidRatingScoreError, RatingScore> {
    if (!Number.isInteger(raw) || raw < MIN_SCORE || raw > MAX_SCORE) {
      return left(new InvalidRatingScoreError(raw))
    }

    return right(new RatingScore({ value: raw }))
  }
}
