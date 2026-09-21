import { UseCaseError } from '@/core/errors/use-case-error'

export class DeliveryNotDeliveredError extends Error implements UseCaseError {
  constructor() {
    super('Only delivered deliveries can be rated')
  }
}
