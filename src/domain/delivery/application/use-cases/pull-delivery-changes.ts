import { Injectable } from '@nestjs/common'

import { Either, right } from '@/core/either'
import { DeliveriesRepository } from '@/domain/delivery/application/repositories/deliveries-repository'
import { DeliveryChangesRepository } from '@/domain/delivery/application/repositories/delivery-changes-repository'
import { SyncStateRepository } from '@/domain/delivery/application/repositories/sync-state-repository'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'
import {
  DeliveryChange,
  DeliveryChangeType,
} from '@/domain/delivery/enterprise/entities/delivery-change'

export interface PullDeliveryChangesUseCaseRequest {
  courierId: string
  sinceVersion: number
  limit: number
}

export interface DeliveryChangeView {
  type: DeliveryChangeType
  version: number
  deliveryId: string
  delivery?: Delivery
}

// O lado esquerdo é `never`: pull não tem caminho de falha de negócio (cursor
// velho, adiantado ou lote vazio são estados válidos da resposta, não erros).
// O Either é mantido mesmo assim para uniformizar a assinatura com os demais
// use cases — todo controller resolve `if (result.isLeft()) throw ...` do
// mesmo jeito, sem um caso especial para este.
export type PullDeliveryChangesUseCaseResponse = Either<
  never,
  {
    currentVersion: number
    nextVersion: number
    hasMore: boolean
    minVersion: number
    resyncRequired: boolean
    changes: DeliveryChangeView[]
  }
>

@Injectable()
export class PullDeliveryChangesUseCase {
  constructor(
    private readonly changes: DeliveryChangesRepository,
    private readonly deliveries: DeliveriesRepository,
    private readonly syncState: SyncStateRepository,
  ) {}

  async execute({
    courierId,
    sinceVersion,
    limit,
  }: PullDeliveryChangesUseCaseRequest): Promise<PullDeliveryChangesUseCaseResponse> {
    const currentVersion = await this.syncState.currentVersion()
    const minVersion = await this.changes.minVersion()

    // Cursor velho demais (log podado) ou adiantado (restore/reset): o cliente
    // não tem como convergir por delta, precisa refazer o snapshot.
    if (sinceVersion > currentVersion || sinceVersion < minVersion) {
      return right({
        currentVersion,
        nextVersion: sinceVersion,
        hasMore: false,
        minVersion,
        resyncRequired: true,
        changes: [],
      })
    }

    // `limit` limita as linhas brutas lidas do log de mudanças, não o
    // tamanho do array `changes` devolvido — a compactação por deliveryId
    // pode encolher bastante o lote final. Não dimensionar payload por
    // `limit`.
    const rows = await this.changes.findManyForCourierSince({
      courierId,
      sinceVersion,
      limit,
    })

    if (rows.length === 0) {
      return right({
        currentVersion,
        nextVersion: sinceVersion,
        hasMore: false,
        minVersion,
        resyncRequired: false,
        changes: [],
      })
    }

    // Ordenação defensiva: o contrato exige que o repositório já devolva em
    // ordem crescente de version, mas o cursor e a compactação não podem
    // depender silenciosamente disso — uma implementação futura sem
    // `ORDER BY` não pode corromper o protocolo.
    const ordered = [...rows].sort((a, b) => a.version - b.version)

    // Cursor do lote é a maior versão lida — nunca currentVersion, senão o
    // cliente pula o que ficou acima do limite e nunca mais recebe.
    const nextVersion = ordered[ordered.length - 1].version
    const hasMore = await this.changes.hasChangesForCourierAfter(
      courierId,
      nextVersion,
    )

    const changes = await Promise.all(
      this.compact(ordered).map((row) => this.toView(row, courierId)),
    )

    return right({
      currentVersion,
      nextVersion,
      hasMore,
      minVersion,
      resyncRequired: false,
      changes,
    })
  }

  /** Mantém só a última mudança de cada entrega: o UPSERT carrega o estado atual. */
  private compact(rows: DeliveryChange[]): DeliveryChange[] {
    const lastByDelivery = new Map<string, DeliveryChange>()

    for (const row of rows) {
      lastByDelivery.set(row.deliveryId.toString(), row)
    }

    return [...lastByDelivery.values()].sort((a, b) => a.version - b.version)
  }

  private async toView(
    row: DeliveryChange,
    courierId: string,
  ): Promise<DeliveryChangeView> {
    const deliveryId = row.deliveryId.toString()

    if (row.type === 'REMOVE') {
      return { type: 'REMOVE', version: row.version, deliveryId }
    }

    const delivery = await this.deliveries.findById(deliveryId)

    const isOutOfScope =
      !delivery ||
      delivery.courierId.toString() !== courierId ||
      delivery.status.value === 'CANCELLED'

    if (isOutOfScope) {
      return { type: 'REMOVE', version: row.version, deliveryId }
    }

    return { type: 'UPSERT', version: row.version, deliveryId, delivery }
  }
}
