import { Controller, Get, Param, Query } from '@nestjs/common'
import { z } from 'zod'

import { PullDeliveryChangesUseCase } from '@/domain/delivery/application/use-cases/pull-delivery-changes'
import { useCaseErrorToHttp } from '@/infrastructure/http/controllers/errors/use-case-error-to-http'
import { DeliveryChangePresenter } from '@/infrastructure/http/presenters/delivery-change-presenter'
import { ZodValidationPipe } from '@/infrastructure/validation/zod-validation.pipe'

const changesQuerySchema = z.object({
  sinceVersion: z.coerce.number().int().min(0),
  limit: z.coerce.number().int().min(1).max(500).default(200),
})

type ChangesQuery = z.infer<typeof changesQuerySchema>

@Controller('/couriers/:courierId/deliveries/changes')
export class PullDeliveryChangesController {
  constructor(private readonly pullChanges: PullDeliveryChangesUseCase) {}

  @Get()
  async handle(
    @Param('courierId') courierId: string,
    @Query(new ZodValidationPipe(changesQuerySchema)) query: ChangesQuery,
  ) {
    const result = await this.pullChanges.execute({ courierId, ...query })

    if (result.isLeft()) {
      throw useCaseErrorToHttp(result.value)
    }

    const { currentVersion, nextVersion, hasMore, minVersion, resyncRequired } =
      result.value

    return {
      currentVersion,
      nextVersion,
      hasMore,
      minVersion,
      resyncRequired,
      changes: result.value.changes.map((change) =>
        DeliveryChangePresenter.toHTTP(change),
      ),
    }
  }
}
