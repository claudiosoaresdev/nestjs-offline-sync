import { UseCaseError } from '@/core/errors/use-case-error'

export class CourierMismatchError extends Error implements UseCaseError {
  constructor() {
    super('Delivery belongs to another courier')
  }
}
