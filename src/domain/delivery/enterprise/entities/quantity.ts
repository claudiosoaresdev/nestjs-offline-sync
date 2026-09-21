import { Either, left, right } from '@/core/either'
import { ValueObject } from '@/core/entities/value-object'
import { InvalidQuantityError } from '@/domain/delivery/application/use-cases/invalid-quantity-error'

interface QuantityProps {
  value: number
}

export class Quantity extends ValueObject<QuantityProps> {
  private constructor(props: QuantityProps) {
    super(props)
  }

  get value(): number {
    return this.props.value
  }

  static create(raw: number): Either<InvalidQuantityError, Quantity> {
    if (!Number.isInteger(raw) || raw < 1) {
      return left(new InvalidQuantityError(raw))
    }

    return right(new Quantity({ value: raw }))
  }
}
