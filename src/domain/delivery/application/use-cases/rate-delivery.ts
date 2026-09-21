import { Injectable } from '@nestjs/common'

import { Either, left, right } from '@/core/either'
import { DeliveriesRepository } from '@/domain/delivery/application/repositories/deliveries-repository'
import { DeliveryNotDeliveredError } from '@/domain/delivery/application/use-cases/errors/delivery-not-delivered-error'
import { DeliveryNotFoundError } from '@/domain/delivery/application/use-cases/errors/delivery-not-found-error'
import { InvalidRatingScoreError } from '@/domain/delivery/application/use-cases/errors/invalid-rating-score-error'
import { RatingAlreadyExistsError } from '@/domain/delivery/application/use-cases/errors/rating-already-exists-error'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'
import { RatingScore } from '@/domain/delivery/enterprise/entities/rating-score'

export interface RateDeliveryUseCaseRequest {
  deliveryId: string
  score: number
  comment: string | null
}

export type RateDeliveryUseCaseResponse = Either<
  | InvalidRatingScoreError
  | DeliveryNotFoundError
  | DeliveryNotDeliveredError
  | RatingAlreadyExistsError,
  { delivery: Delivery }
>

@Injectable()
export class RateDeliveryUseCase {
  constructor(private readonly deliveries: DeliveriesRepository) {}

  async execute({
    deliveryId,
    score,
    comment,
  }: RateDeliveryUseCaseRequest): Promise<RateDeliveryUseCaseResponse> {
    const ratingScore = RatingScore.create(score)

    if (ratingScore.isLeft()) {
      return left(ratingScore.value)
    }

    const delivery = await this.deliveries.findById(deliveryId)

    if (!delivery) {
      return left(new DeliveryNotFoundError())
    }

    const rated = delivery.rate(ratingScore.value, comment)

    if (rated.isLeft()) {
      return left(rated.value)
    }

    await this.deliveries.save(delivery)

    return right({ delivery })
  }
}
