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

export interface HasChangesForCourierAfterParams {
  courierId: string
  version: number
}

export abstract class DeliveryChangesRepository {
  abstract append(input: AppendDeliveryChangeInput): Promise<DeliveryChange>
  /**
   * As linhas devolvidas DEVEM vir ordenadas por `version` ascendente. Quem
   * consome este método (compactação do lote e cálculo do cursor de
   * paginação) depende dessa ordem — uma implementação sem `ORDER BY`
   * devolveria estado velho na compactação e avançaria o cursor além do que
   * foi de fato entregue, em silêncio.
   */
  abstract findManyForCourierSince(
    params: FindChangesForCourierParams,
  ): Promise<DeliveryChange[]>
  abstract hasChangesForCourierAfter(
    params: HasChangesForCourierAfterParams,
  ): Promise<boolean>
  abstract minVersion(): Promise<number>
}
