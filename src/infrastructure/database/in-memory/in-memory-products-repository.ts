import { Injectable } from '@nestjs/common'

import { ProductsRepository } from '@/domain/delivery/application/repositories/products-repository'
import { Product } from '@/domain/delivery/enterprise/entities/product'

@Injectable()
export class InMemoryProductsRepository extends ProductsRepository {
  public items: Product[] = []

  findById(id: string): Promise<Product | null> {
    return Promise.resolve(
      this.items.find((item) => item.id.toString() === id) ?? null,
    )
  }

  findManyByIds(ids: string[]): Promise<Product[]> {
    return Promise.resolve(
      this.items.filter((item) => ids.includes(item.id.toString())),
    )
  }
}
