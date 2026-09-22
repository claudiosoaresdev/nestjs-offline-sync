import { Entity } from '@/core/entities/entity'
import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { Product } from '@/domain/delivery/enterprise/entities/product'
import { Quantity } from '@/domain/delivery/enterprise/entities/quantity'

export interface DeliveryItemProps {
  productId: UniqueEntityID
  productName: string
  unitPriceCents: number
  quantity: Quantity
}

export class DeliveryItem extends Entity<DeliveryItemProps> {
  get productId(): UniqueEntityID {
    return this.props.productId
  }

  get productName(): string {
    return this.props.productName
  }

  get unitPriceCents(): number {
    return this.props.unitPriceCents
  }

  get quantity(): Quantity {
    return this.props.quantity
  }

  get subtotalCents(): number {
    return this.props.unitPriceCents * this.props.quantity.value
  }

  static create(props: DeliveryItemProps, id?: UniqueEntityID): DeliveryItem {
    return new DeliveryItem(props, id)
  }

  static fromProduct(product: Product, quantity: Quantity): DeliveryItem {
    return new DeliveryItem({
      productId: product.id,
      productName: product.name,
      unitPriceCents: product.priceCents,
      quantity,
    })
  }
}
