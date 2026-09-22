import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'

export interface FindManyByCourierParams {
  courierId: string
  limit: number
  cursor?: string
}

export abstract class DeliveriesRepository {
  abstract findById(id: string): Promise<Delivery | null>
  /**
   * Paginação por keyset: devolve entregas com `id` maior que `cursor`,
   * ordenadas por `id` ascendente — o equivalente a
   * `WHERE id > $cursor ORDER BY id LIMIT $limit` no Postgres. Um cursor que
   * saiu da lista filtrada (cancelado ou reatribuído durante a paginação)
   * não é um caso especial: a página seguinte continua normalmente a partir
   * dele, porque a posição nunca dependeu de o cursor ainda existir.
   */
  abstract findManyByCourier(
    params: FindManyByCourierParams,
  ): Promise<Delivery[]>
  abstract countByCourier(courierId: string): Promise<number>
  abstract create(delivery: Delivery): Promise<void>
  /** Entrega inexistente é no-op: nada é gravado e nenhum evento é despachado. */
  abstract save(delivery: Delivery): Promise<void>
}
