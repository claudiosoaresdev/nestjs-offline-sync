import { Injectable } from '@nestjs/common'

import { Either, left, right } from '@/core/either'
import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { ResourceNotFoundError } from '@/core/errors/resource-not-found-error'
import { DeliveriesRepository } from '@/domain/delivery/application/repositories/deliveries-repository'
import { ProductsRepository } from '@/domain/delivery/application/repositories/products-repository'
import { InvalidQuantityError } from '@/domain/delivery/application/use-cases/errors/invalid-quantity-error'
import { CustomerInfo } from '@/domain/delivery/enterprise/entities/customer-info'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'
import { DeliveryItem } from '@/domain/delivery/enterprise/entities/delivery-item'
import { Quantity } from '@/domain/delivery/enterprise/entities/quantity'

export interface DeliveryItemInput {
  productId: string
  quantity: number
}

export interface CreateDeliveryUseCaseRequest {
  courierId: string
  customer: { name: string; phone: string; address: string }
  items: DeliveryItemInput[]
}

export type CreateDeliveryUseCaseResponse = Either<
  ResourceNotFoundError | InvalidQuantityError,
  { delivery: Delivery }
>

@Injectable()
export class CreateDeliveryUseCase {
  constructor(
    private readonly deliveries: DeliveriesRepository,
    private readonly products: ProductsRepository,
  ) {}

  async execute({
    courierId,
    customer,
    items,
  }: CreateDeliveryUseCaseRequest): Promise<CreateDeliveryUseCaseResponse> {
    const built = await buildItems(this.products, items)

    if (built.isLeft()) {
      return left(built.value)
    }

    const delivery = Delivery.create({
      courierId: new UniqueEntityID(courierId),
      customer: CustomerInfo.create(customer),
      items: built.value,
    })

    await this.deliveries.create(delivery)

    return right({ delivery })
  }
}

/** Resolve produtos e quantidades. Compartilhado com o UpdateDeliveryUseCase. */
export async function buildItems(
  products: ProductsRepository,
  items: DeliveryItemInput[],
): Promise<
  Either<ResourceNotFoundError | InvalidQuantityError, DeliveryItem[]>
> {
  const productIds = items.map((item) => item.productId)
  const foundProducts = await products.findManyByIds(productIds)
  const productMap = new Map(foundProducts.map((p) => [p.id.toString(), p]))

  const built: DeliveryItem[] = []

  for (const item of items) {
    const product = productMap.get(item.productId)

    if (!product) {
      return left(new ResourceNotFoundError())
    }

    const quantity = Quantity.create(item.quantity)

    if (quantity.isLeft()) {
      return left(quantity.value)
    }

    built.push(DeliveryItem.fromProduct(product, quantity.value))
  }

  return right(built)
}
