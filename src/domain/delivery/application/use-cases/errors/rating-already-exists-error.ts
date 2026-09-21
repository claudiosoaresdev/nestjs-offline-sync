import { UseCaseError } from '@/core/errors/use-case-error'

export class RatingAlreadyExistsError extends Error implements UseCaseError {
  constructor() {
    super('Delivery has already been rated')
  }
}
