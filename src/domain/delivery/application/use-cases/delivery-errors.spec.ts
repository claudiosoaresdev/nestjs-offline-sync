import { describe, expect, it } from 'vitest'

import { UseCaseError } from '@/core/errors/use-case-error'
import { CourierMismatchError } from '@/domain/delivery/application/use-cases/courier-mismatch-error'
import { DeliveryAlreadyFinalizedError } from '@/domain/delivery/application/use-cases/delivery-already-finalized-error'
import { DeliveryNotDeliveredError } from '@/domain/delivery/application/use-cases/delivery-not-delivered-error'
import { DeliveryNotFoundError } from '@/domain/delivery/application/use-cases/delivery-not-found-error'
import { InvalidStatusTransitionError } from '@/domain/delivery/application/use-cases/invalid-status-transition-error'
import { RatingAlreadyExistsError } from '@/domain/delivery/application/use-cases/rating-already-exists-error'

describe('erros de domínio da entrega', () => {
  it('todos implementam UseCaseError com mensagem', () => {
    const errors: UseCaseError[] = [
      new DeliveryNotFoundError(),
      new CourierMismatchError(),
      new InvalidStatusTransitionError('DELIVERED', 'PENDING'),
      new DeliveryAlreadyFinalizedError(),
      new DeliveryNotDeliveredError(),
      new RatingAlreadyExistsError(),
    ]

    for (const error of errors) {
      expect(error.message.length).toBeGreaterThan(0)
    }
  })

  it('a transição inválida diz de onde para onde', () => {
    expect(
      new InvalidStatusTransitionError('DELIVERED', 'PENDING').message,
    ).toContain('DELIVERED')
  })
})
