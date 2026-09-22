import { UseCaseError } from '@/core/errors/use-case-error'

export class InvalidCancelReasonError extends Error implements UseCaseError {
  constructor() {
    super('Cancel reason must not be empty or contain only whitespace')
  }
}
