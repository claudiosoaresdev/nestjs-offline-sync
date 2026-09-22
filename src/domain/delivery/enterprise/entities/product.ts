import { Entity } from '@/core/entities/entity'
import { UniqueEntityID } from '@/core/entities/unique-entity-id'

export interface ProductProps {
  name: string
  priceCents: number
}

export class Product extends Entity<ProductProps> {
  get name(): string {
    return this.props.name
  }

  get priceCents(): number {
    return this.props.priceCents
  }

  static create(props: ProductProps, id?: UniqueEntityID): Product {
    return new Product(props, id)
  }
}
