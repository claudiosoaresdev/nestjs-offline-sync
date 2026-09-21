import { UseCaseError } from '@/core/errors/use-case-error'

export class InvalidQuantityError extends Error implements UseCaseError {
  constructor(raw: number) {
    super(`Invalid quantity: ${raw}. Expected a positive integer`)
  }
}
