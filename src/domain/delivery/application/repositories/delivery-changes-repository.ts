import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import {
  DeliveryChange,
  DeliveryChangeType,
} from '@/domain/delivery/enterprise/entities/delivery-change'

export interface AppendDeliveryChangeInput {
  type: DeliveryChangeType
  deliveryId: UniqueEntityID
  courierId: UniqueEntityID
}

export interface FindChangesForCourierParams {
  courierId: string
  sinceVersion: number
  limit: number
}

export abstract class DeliveryChangesRepository {
  abstract append(input: AppendDeliveryChangeInput): Promise<DeliveryChange>
  abstract findManyForCourierSince(
    params: FindChangesForCourierParams,
  ): Promise<DeliveryChange[]>
  abstract hasChangesForCourierAfter(
    courierId: string,
    version: number,
  ): Promise<boolean>
  abstract minVersion(): Promise<number>
}
