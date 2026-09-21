import { Body, Controller, HttpCode, Post } from '@nestjs/common'
import { z } from 'zod'

import { CreateDeliveryUseCase } from '@/domain/delivery/application/use-cases/create-delivery'
import { useCaseErrorToHttp } from '@/infrastructure/http/controllers/errors/use-case-error-to-http'
import { DeliveryPresenter } from '@/infrastructure/http/presenters/delivery-presenter'
import { ZodValidationPipe } from '@/infrastructure/validation/zod-validation.pipe'

const createDeliveryBodySchema = z.object({
  courierId: z.string().uuid(),
  customer: z.object({
    name: z.string().min(1).max(120),
    phone: z.string().min(8).max(20),
    address: z.string().min(1).max(200),
  }),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1),
      }),
    )
    .min(1),
})

type CreateDeliveryBody = z.infer<typeof createDeliveryBodySchema>

@Controller('/deliveries')
export class CreateDeliveryController {
  constructor(private readonly createDelivery: CreateDeliveryUseCase) {}

  @Post()
  @HttpCode(201)
  async handle(
    @Body(new ZodValidationPipe(createDeliveryBodySchema))
    body: CreateDeliveryBody,
  ) {
    const result = await this.createDelivery.execute(body)

    if (result.isLeft()) {
      throw useCaseErrorToHttp(result.value)
    }

    return { delivery: DeliveryPresenter.toHTTP(result.value.delivery) }
  }
}
