import type { HttpException } from '@nestjs/common'
import {
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common'

import { NotAllowedError } from '@/core/errors/not-allowed-error'
import { ResourceNotFoundError } from '@/core/errors/resource-not-found-error'
import type { UseCaseError } from '@/core/errors/use-case-error'
import { CourierMismatchError } from '@/domain/delivery/application/use-cases/errors/courier-mismatch-error'
import { DeliveryAlreadyFinalizedError } from '@/domain/delivery/application/use-cases/errors/delivery-already-finalized-error'
import { DeliveryNotDeliveredError } from '@/domain/delivery/application/use-cases/errors/delivery-not-delivered-error'
import { DeliveryNotFoundError } from '@/domain/delivery/application/use-cases/errors/delivery-not-found-error'
import { InvalidCancelReasonError } from '@/domain/delivery/application/use-cases/errors/invalid-cancel-reason-error'
import { InvalidQuantityError } from '@/domain/delivery/application/use-cases/errors/invalid-quantity-error'
import { InvalidRatingScoreError } from '@/domain/delivery/application/use-cases/errors/invalid-rating-score-error'
import { InvalidStatusTransitionError } from '@/domain/delivery/application/use-cases/errors/invalid-status-transition-error'
import { RatingAlreadyExistsError } from '@/domain/delivery/application/use-cases/errors/rating-already-exists-error'

export function useCaseErrorToHttp(error: UseCaseError): HttpException {
  const message = error.message

  switch (error.constructor) {
    case ResourceNotFoundError:
    case DeliveryNotFoundError:
      return new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message })
    case NotAllowedError:
      return new UnauthorizedException({ code: 'NOT_ALLOWED', message })
    case CourierMismatchError:
      return new ForbiddenException({ code: 'COURIER_MISMATCH', message })
    case InvalidStatusTransitionError:
      return new ConflictException({
        code: 'INVALID_STATUS_TRANSITION',
        message,
      })
    case DeliveryAlreadyFinalizedError:
      return new ConflictException({
        code: 'DELIVERY_ALREADY_FINALIZED',
        message,
      })
    case DeliveryNotDeliveredError:
      return new ConflictException({
        code: 'DELIVERY_NOT_DELIVERED',
        message,
      })
    case RatingAlreadyExistsError:
      return new ConflictException({
        code: 'RATING_ALREADY_EXISTS',
        message,
      })
    case InvalidRatingScoreError:
      return new UnprocessableEntityException({
        code: 'INVALID_RATING_SCORE',
        message,
      })
    case InvalidQuantityError:
      return new UnprocessableEntityException({
        code: 'INVALID_QUANTITY',
        message,
      })
    case InvalidCancelReasonError:
      return new UnprocessableEntityException({
        code: 'INVALID_CANCEL_REASON',
        message,
      })
    default:
      return new InternalServerErrorException({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
      })
  }
}
