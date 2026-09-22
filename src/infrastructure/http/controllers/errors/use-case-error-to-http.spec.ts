import {
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { describe, expect, it } from 'vitest'

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
import { useCaseErrorToHttp } from '@/infrastructure/http/controllers/errors/use-case-error-to-http'

class UnknownError extends Error implements UseCaseError {
  constructor() {
    super('boom')
  }
}

describe('useCaseErrorToHttp', () => {
  it('mapeia ResourceNotFoundError para 404', () => {
    expect(useCaseErrorToHttp(new ResourceNotFoundError())).toBeInstanceOf(
      NotFoundException,
    )
  })

  it('mapeia NotAllowedError para 401', () => {
    expect(useCaseErrorToHttp(new NotAllowedError())).toBeInstanceOf(
      UnauthorizedException,
    )
  })

  it('cai em 500 genérico para erro não mapeado, sem vazar a mensagem', () => {
    const exception = useCaseErrorToHttp(new UnknownError())

    expect(exception).toBeInstanceOf(InternalServerErrorException)
    expect(JSON.stringify(exception.getResponse())).not.toContain('boom')
  })

  it('mapeia os erros de entrega para os status corretos', () => {
    expect(useCaseErrorToHttp(new DeliveryNotFoundError())).toBeInstanceOf(
      NotFoundException,
    )
    expect(useCaseErrorToHttp(new CourierMismatchError())).toBeInstanceOf(
      ForbiddenException,
    )
    expect(
      useCaseErrorToHttp(
        new InvalidStatusTransitionError('PENDING', 'DELIVERED'),
      ),
    ).toBeInstanceOf(ConflictException)
    expect(
      useCaseErrorToHttp(new DeliveryAlreadyFinalizedError()),
    ).toBeInstanceOf(ConflictException)
    expect(useCaseErrorToHttp(new DeliveryNotDeliveredError())).toBeInstanceOf(
      ConflictException,
    )
    expect(useCaseErrorToHttp(new RatingAlreadyExistsError())).toBeInstanceOf(
      ConflictException,
    )
    expect(useCaseErrorToHttp(new InvalidRatingScoreError(9))).toBeInstanceOf(
      UnprocessableEntityException,
    )
    expect(useCaseErrorToHttp(new InvalidQuantityError(0))).toBeInstanceOf(
      UnprocessableEntityException,
    )
    expect(useCaseErrorToHttp(new InvalidCancelReasonError())).toBeInstanceOf(
      UnprocessableEntityException,
    )
  })
})
