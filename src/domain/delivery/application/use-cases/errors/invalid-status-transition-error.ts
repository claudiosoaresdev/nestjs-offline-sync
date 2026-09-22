import { UseCaseError } from '@/core/errors/use-case-error'
import { DeliveryStatusValue } from '@/domain/delivery/enterprise/entities/delivery-status'

export class InvalidStatusTransitionError
  extends Error
  implements UseCaseError
{
  constructor(
    readonly from: DeliveryStatusValue,
    readonly to: DeliveryStatusValue,
  ) {
    super(`Invalid status transition: ${from} -> ${to}`)
  }
}
