import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { Product } from '@/domain/delivery/enterprise/entities/product'
import { InMemoryProductsRepository } from '@/infrastructure/database/in-memory/in-memory-products-repository'

export const SEEDED_PRODUCT_IDS = {
  coffee: 'b6f0b4c2-0000-4000-8000-000000000001',
  mug: 'b6f0b4c2-0000-4000-8000-000000000002',
  filter: 'b6f0b4c2-0000-4000-8000-000000000003',
} as const

export function seedProducts(
  repository: InMemoryProductsRepository,
): InMemoryProductsRepository {
  repository.items.push(
    Product.create(
      { name: 'Café torrado 500g', priceCents: 3990 },
      new UniqueEntityID(SEEDED_PRODUCT_IDS.coffee),
    ),
    Product.create(
      { name: 'Caneca cerâmica', priceCents: 2490 },
      new UniqueEntityID(SEEDED_PRODUCT_IDS.mug),
    ),
    Product.create(
      { name: 'Filtro de papel', priceCents: 990 },
      new UniqueEntityID(SEEDED_PRODUCT_IDS.filter),
    ),
  )

  return repository
}
