import { Injectable } from '@nestjs/common'

import { Either, right } from '@/core/either'
import { DeliveriesRepository } from '@/domain/delivery/application/repositories/deliveries-repository'
import { SyncStateRepository } from '@/domain/delivery/application/repositories/sync-state-repository'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'

export interface GetDeliverySnapshotUseCaseRequest {
  courierId: string
  limit: number
  withTotal: boolean
  cursor?: string
}

// O lado esquerdo é `never`: snapshot não tem caminho de falha de negócio,
// só devolve páginas (eventualmente vazias) da lista do courier. O Either é
// mantido mesmo assim para uniformizar a assinatura com os demais use cases
// — todo controller resolve `if (result.isLeft()) throw ...` do mesmo jeito.
export type GetDeliverySnapshotUseCaseResponse = Either<
  never,
  {
    currentVersion: number
    totalItems?: number
    deliveries: Delivery[]
    nextCursor?: string
  }
>

@Injectable()
export class GetDeliverySnapshotUseCase {
  constructor(
    private readonly deliveries: DeliveriesRepository,
    private readonly syncState: SyncStateRepository,
  ) {}

  async execute({
    courierId,
    limit,
    withTotal,
    cursor,
  }: GetDeliverySnapshotUseCaseRequest): Promise<GetDeliverySnapshotUseCaseResponse> {
    // Âncora lida antes da página: o que mudar durante a paginação cai no delta.
    const currentVersion = await this.syncState.currentVersion()

    const rows = await this.deliveries.findManyByCourier({
      courierId,
      limit: limit + 1,
      cursor,
    })

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows

    const totalItems = withTotal
      ? await this.deliveries.countByCourier(courierId)
      : undefined

    return right({
      currentVersion,
      totalItems,
      deliveries: page,
      nextCursor: hasMore ? page[page.length - 1].id.toString() : undefined,
    })
  }
}
