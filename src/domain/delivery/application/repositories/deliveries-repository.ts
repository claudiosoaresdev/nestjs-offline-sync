import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'

export interface FindManyByCourierParams {
  courierId: string
  limit: number
  cursor?: string
}

export abstract class DeliveriesRepository {
  abstract findById(id: string): Promise<Delivery | null>
  /**
   * Cursor não encontrado devolve lista vazia — mesmo formato usado para
   * sinalizar que não há mais páginas.
   */
  abstract findManyByCourier(
    params: FindManyByCourierParams,
  ): Promise<Delivery[]>
  abstract countByCourier(courierId: string): Promise<number>
  abstract create(delivery: Delivery): Promise<void>
  /** Entrega inexistente é no-op: nada é gravado e nenhum evento é despachado. */
  abstract save(delivery: Delivery): Promise<void>
}
