import { Body, Controller, Param, Patch } from '@nestjs/common'
import { z } from 'zod'

import { UpdateDeliveryUseCase } from '@/domain/delivery/application/use-cases/update-delivery'
import { useCaseErrorToHttp } from '@/infrastructure/http/controllers/errors/use-case-error-to-http'
import { DeliveryPresenter } from '@/infrastructure/http/presenters/delivery-presenter'
import { ZodValidationPipe } from '@/infrastructure/validation/zod-validation.pipe'

const updateDeliveryBodySchema = z.object({
  courierId: z.string().uuid().optional(),
  customer: z
    .object({
      name: z.string().min(1).max(120),
      phone: z.string().min(8).max(20),
      address: z.string().min(1).max(200),
    })
    .optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1),
      }),
    )
    .optional(),
  cancelReason: z.string().min(1).max(200).optional(),
})

type UpdateDeliveryBody = z.infer<typeof updateDeliveryBodySchema>

@Controller('/deliveries/:deliveryId')
export class UpdateDeliveryController {
  constructor(private readonly updateDelivery: UpdateDeliveryUseCase) {}

  @Patch()
  async handle(
    @Param('deliveryId') deliveryId: string,
    @Body(new ZodValidationPipe(updateDeliveryBodySchema))
    body: UpdateDeliveryBody,
  ) {
    const result = await this.updateDelivery.execute({ deliveryId, ...body })

    if (result.isLeft()) {
      throw useCaseErrorToHttp(result.value)
    }

    return { delivery: DeliveryPresenter.toHTTP(result.value.delivery) }
  }
}
