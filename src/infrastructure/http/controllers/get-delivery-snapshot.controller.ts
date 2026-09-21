import { Controller, Get, Param, Query } from '@nestjs/common'
import { z } from 'zod'

import { GetDeliverySnapshotUseCase } from '@/domain/delivery/application/use-cases/get-delivery-snapshot'
import { useCaseErrorToHttp } from '@/infrastructure/http/controllers/errors/use-case-error-to-http'
import { DeliveryPresenter } from '@/infrastructure/http/presenters/delivery-presenter'
import { ZodValidationPipe } from '@/infrastructure/validation/zod-validation.pipe'

const snapshotQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().uuid().optional(),
  // z.coerce.boolean() trataria a string "false" como true — daí o enum explícito.
  withTotal: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
})

type SnapshotQuery = z.infer<typeof snapshotQuerySchema>

@Controller('/couriers/:courierId/deliveries/snapshot')
export class GetDeliverySnapshotController {
  constructor(private readonly getSnapshot: GetDeliverySnapshotUseCase) {}

  @Get()
  async handle(
    @Param('courierId') courierId: string,
    @Query(new ZodValidationPipe(snapshotQuerySchema)) query: SnapshotQuery,
  ) {
    const result = await this.getSnapshot.execute({ courierId, ...query })

    if (result.isLeft()) {
      throw useCaseErrorToHttp(result.value)
    }

    return {
      currentVersion: result.value.currentVersion,
      totalItems: result.value.totalItems,
      nextCursor: result.value.nextCursor,
      deliveries: result.value.deliveries.map((delivery) =>
        DeliveryPresenter.toHTTP(delivery),
      ),
    }
  }
}
