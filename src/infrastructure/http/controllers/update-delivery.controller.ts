import { Body, Controller, Param, Patch } from '@nestjs/common'
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { z } from 'zod'

import { UpdateDeliveryUseCase } from '@/domain/delivery/application/use-cases/update-delivery'
import { useCaseErrorToHttp } from '@/infrastructure/http/controllers/errors/use-case-error-to-http'
import { DeliveryPresenter } from '@/infrastructure/http/presenters/delivery-presenter'
import { zodValidationErrorSchema } from '@/infrastructure/swagger/zod-validation-error.schema'
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

@ApiTags('deliveries')
@Controller('/deliveries/:deliveryId')
export class UpdateDeliveryController {
  constructor(private readonly updateDelivery: UpdateDeliveryUseCase) {}

  @Patch()
  @ApiOperation({
    summary: 'Atualiza itens, cliente, reatribui ou cancela uma entrega',
    description:
      'Todos os campos são opcionais e independentes: envie só o que muda. ' +
      '`items` substitui o lote inteiro (não faz merge item a item). Enviar ' +
      '`cancelReason` cancela a entrega — uma vez PENDING/OUT_FOR_DELIVERY ela vai ' +
      'para CANCELLED e nenhum outro campo do mesmo request é aplicado depois ' +
      'disso. Qualquer mutação bem-sucedida emite change de domínio e aparece no ' +
      'próximo delta do(s) entregador(es) afetado(s) — inclusive o antigo, que ' +
      'recebe um REMOVE quando a entrega é reatribuída.',
  })
  @ApiParam({
    name: 'deliveryId',
    description: 'Id da entrega',
    example: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        courierId: {
          type: 'string',
          format: 'uuid',
          description: 'Reatribui a entrega a outro entregador.',
          example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        },
        customer: {
          type: 'object',
          required: ['name', 'phone', 'address'],
          properties: {
            name: {
              type: 'string',
              minLength: 1,
              maxLength: 120,
              example: 'Maria Oliveira',
            },
            phone: {
              type: 'string',
              minLength: 8,
              maxLength: 20,
              example: '+55 11 98888-7777',
            },
            address: {
              type: 'string',
              minLength: 1,
              maxLength: 200,
              example: 'Rua das Acácias, 120 — São Paulo/SP',
            },
          },
        },
        items: {
          type: 'array',
          description: 'Substitui o lote inteiro de itens.',
          items: {
            type: 'object',
            required: ['productId', 'quantity'],
            properties: {
              productId: { type: 'string', format: 'uuid' },
              quantity: { type: 'integer', minimum: 1, example: 2 },
            },
          },
        },
        cancelReason: {
          type: 'string',
          minLength: 1,
          maxLength: 200,
          description: 'Presença deste campo cancela a entrega.',
          example: 'Cliente desistiu da compra',
        },
      },
      example: { courierId: '3fa85f64-5717-4562-b3fc-2c963f66afa6' },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Entrega atualizada',
    schema: {
      type: 'object',
      properties: {
        delivery: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            courierId: { type: 'string', format: 'uuid' },
            status: { type: 'string', example: 'OUT_FOR_DELIVERY' },
            attempts: { type: 'integer', example: 0 },
            customer: { type: 'object' },
            items: { type: 'array', items: { type: 'object' } },
            totalCents: { type: 'integer', example: 5970 },
            rating: { type: 'object', nullable: true },
            receivedBy: { type: 'string', nullable: true },
            deliveredAt: { type: 'string', nullable: true },
            revision: { type: 'integer', example: 2 },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description:
      'RESOURCE_NOT_FOUND — a entrega não existe, ou algum productId do lote de items não existe no catálogo.',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string', example: 'RESOURCE_NOT_FOUND' },
        message: {
          type: 'string',
          example: 'Delivery not found',
        },
      },
    },
  })
  @ApiResponse({
    status: 409,
    description:
      'DELIVERY_ALREADY_FINALIZED — a entrega já está DELIVERED ou CANCELLED e ' +
      'não pode mais mudar; ou INVALID_STATUS_TRANSITION — a mudança pedida não é ' +
      'uma transição de status válida.',
    schema: {
      oneOf: [
        {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'DELIVERY_ALREADY_FINALIZED' },
            message: {
              type: 'string',
              example: 'Delivery is already finalized and cannot be changed',
            },
          },
        },
        {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'INVALID_STATUS_TRANSITION' },
            message: {
              type: 'string',
              example: 'Invalid status transition: DELIVERED -> PENDING',
            },
          },
        },
      ],
    },
  })
  @ApiResponse({
    status: 422,
    description:
      'Corpo inválido (Zod); ou INVALID_CANCEL_REASON — cancelReason vazio ou só ' +
      'espaços; ou INVALID_QUANTITY — quantidade de algum item excede o estoque.',
    schema: {
      oneOf: [
        zodValidationErrorSchema,
        {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'INVALID_CANCEL_REASON' },
            message: {
              type: 'string',
              example:
                'Cancel reason must not be empty or contain only whitespace',
            },
          },
        },
        {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'INVALID_QUANTITY' },
            message: {
              type: 'string',
              example: 'Invalid quantity: 0. Expected a positive integer',
            },
          },
        },
      ],
    },
  })
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
