import { Product } from '@/domain/delivery/enterprise/entities/product'

export abstract class ProductsRepository {
  abstract findById(id: string): Promise<Product | null>
  abstract findManyByIds(ids: string[]): Promise<Product[]>
}
