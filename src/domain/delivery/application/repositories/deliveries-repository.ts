import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'

export interface FindManyByCourierParams {
  courierId: string
  limit: number
  cursor?: string
}

export abstract class DeliveriesRepository {
  abstract findById(id: string): Promise<Delivery | null>
  abstract findManyByCourier(
    params: FindManyByCourierParams,
  ): Promise<Delivery[]>
  abstract countByCourier(courierId: string): Promise<number>
  abstract create(delivery: Delivery): Promise<void>
  abstract save(delivery: Delivery): Promise<void>
}
