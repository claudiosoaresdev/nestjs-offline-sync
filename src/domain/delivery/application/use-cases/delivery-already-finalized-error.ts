import { UseCaseError } from '@/core/errors/use-case-error'

export class DeliveryAlreadyFinalizedError
  extends Error
  implements UseCaseError
{
  constructor() {
    super('Delivery is already finalized and cannot be changed')
  }
}
