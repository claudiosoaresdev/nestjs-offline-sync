import { Injectable } from '@nestjs/common'

import { Either, left, right } from '@/core/either'
import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { ResourceNotFoundError } from '@/core/errors/resource-not-found-error'
import { DeliveriesRepository } from '@/domain/delivery/application/repositories/deliveries-repository'
import { ProductsRepository } from '@/domain/delivery/application/repositories/products-repository'
import {
  buildItems,
  DeliveryItemInput,
} from '@/domain/delivery/application/use-cases/create-delivery'
import { DeliveryAlreadyFinalizedError } from '@/domain/delivery/application/use-cases/errors/delivery-already-finalized-error'
import { DeliveryNotFoundError } from '@/domain/delivery/application/use-cases/errors/delivery-not-found-error'
import { InvalidCancelReasonError } from '@/domain/delivery/application/use-cases/errors/invalid-cancel-reason-error'
import { InvalidQuantityError } from '@/domain/delivery/application/use-cases/errors/invalid-quantity-error'
import { InvalidStatusTransitionError } from '@/domain/delivery/application/use-cases/errors/invalid-status-transition-error'
import { CustomerInfo } from '@/domain/delivery/enterprise/entities/customer-info'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'

export interface UpdateDeliveryUseCaseRequest {
  deliveryId: string
  courierId?: string
  customer?: { name: string; phone: string; address: string }
  items?: DeliveryItemInput[]
  cancelReason?: string
}

export type UpdateDeliveryUseCaseResponse = Either<
  | DeliveryNotFoundError
  | DeliveryAlreadyFinalizedError
  | InvalidStatusTransitionError
  | ResourceNotFoundError
  | InvalidQuantityError
  | InvalidCancelReasonError,
  { delivery: Delivery }
>

@Injectable()
export class UpdateDeliveryUseCase {
  constructor(
    private readonly deliveries: DeliveriesRepository,
    private readonly products: ProductsRepository,
  ) {}

  async execute({
    deliveryId,
    courierId,
    customer,
    items,
    cancelReason,
  }: UpdateDeliveryUseCaseRequest): Promise<UpdateDeliveryUseCaseResponse> {
    const delivery = await this.deliveries.findById(deliveryId)

    if (!delivery) {
      return left(new DeliveryNotFoundError())
    }

    // O repositório in-memory devolve a referência viva do agregado: uma
    // mutação abaixo já vale mesmo sem `save`. Por isso toda validação que
    // pode falhar — incluindo a de `cancelReason` — precisa acontecer aqui,
    // antes da primeira chamada que muda estado. É isso que impede um
    // evento de domínio órfão (mutação aplicada, `save` nunca chamado,
    // evento pendurado em `DomainEvents.markedAggregates` até o próximo
    // `save` daquela entrega).
    if (cancelReason !== undefined && !cancelReason.trim()) {
      return left(new InvalidCancelReasonError())
    }

    if (items) {
      const built = await buildItems(this.products, items)

      if (built.isLeft()) {
        return left(built.value)
      }

      const changed = delivery.changeItems(built.value)

      if (changed.isLeft()) {
        return left(changed.value)
      }
    }

    if (customer) {
      const changed = delivery.changeCustomer(CustomerInfo.create(customer))

      if (changed.isLeft()) {
        return left(changed.value)
      }
    }

    if (courierId) {
      const assigned = delivery.assignTo(new UniqueEntityID(courierId))

      if (assigned.isLeft()) {
        return left(assigned.value)
      }
    }

    if (cancelReason !== undefined) {
      const cancelled = delivery.cancel(cancelReason.trim())

      if (cancelled.isLeft()) {
        return left(cancelled.value)
      }
    }

    await this.deliveries.save(delivery)

    return right({ delivery })
  }
}
