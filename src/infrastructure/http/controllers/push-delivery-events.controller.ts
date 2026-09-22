import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common'
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { z } from 'zod'

import { PushDeliveryEventsUseCase } from '@/domain/delivery/application/use-cases/push-delivery-events'
import { useCaseErrorToHttp } from '@/infrastructure/http/controllers/errors/use-case-error-to-http'
import { DeliveryPresenter } from '@/infrastructure/http/presenters/delivery-presenter'
import { zodValidationErrorSchema } from '@/infrastructure/swagger/zod-validation-error.schema'
import { ZodValidationPipe } from '@/infrastructure/validation/zod-validation.pipe'

const pushEventsBodySchema = z.object({
  events: z
    .array(
      z.object({
        clientEventId: z.string().uuid(),
        deliveryId: z.string().uuid(),
        type: z.enum(['OUT_FOR_DELIVERY', 'FAILED_ATTEMPT', 'DELIVERED']),
        occurredAt: z.coerce.date(),
        reason: z.string().max(200).optional(),
        receivedBy: z.string().max(120).optional(),
      }),
    )
    .min(1)
    .max(200),
})

type PushEventsBody = z.infer<typeof pushEventsBodySchema>

@ApiTags('sync')
@Controller('/couriers/:courierId/deliveries/events')
export class PushDeliveryEventsController {
  constructor(private readonly pushEvents: PushDeliveryEventsUseCase) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Envia em lote os eventos de campo acumulados offline',
    description:
      'O entregador acumula eventos sem rede e sobe tudo de uma vez ao reconectar. ' +
      'O lote é **idempotente por clientEventId**: reenviar o mesmo id devolve ' +
      'DUPLICATE sem reaplicar. Eventos chegam fora de ordem — são aplicados por ' +
      '`occurredAt` dentro de cada entrega, não pela posição no array. A resposta ' +
      'é sempre **200, mesmo com itens rejeitados**: rejeição é resultado de ' +
      'negócio (o mundo mudou enquanto o entregador estava offline), não erro de ' +
      'transporte — um evento velho nunca derruba o lote do dia inteiro. Cada ' +
      'resultado é posicional (mesmo índice do evento enviado) e traz `status` ' +
      '(APPLIED, DUPLICATE ou REJECTED); quando REJECTED, também traz `code` e o ' +
      '`delivery` no estado atual para o app reconciliar o cache local.',
  })
  @ApiParam({
    name: 'courierId',
    description: 'Id do entregador',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['events'],
      properties: {
        events: {
          type: 'array',
          minItems: 1,
          maxItems: 200,
          items: {
            type: 'object',
            required: ['clientEventId', 'deliveryId', 'type', 'occurredAt'],
            properties: {
              clientEventId: {
                type: 'string',
                format: 'uuid',
                description: 'Gerado no dispositivo — chave de idempotência.',
                example: '018f2e6e-9c1b-7c3a-9f2e-1a2b3c4d5e6f',
              },
              deliveryId: {
                type: 'string',
                format: 'uuid',
                example: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
              },
              type: {
                type: 'string',
                enum: ['OUT_FOR_DELIVERY', 'FAILED_ATTEMPT', 'DELIVERED'],
                example: 'DELIVERED',
              },
              occurredAt: {
                type: 'string',
                format: 'date-time',
                description: 'Timestamp do dispositivo no momento do evento.',
                example: '2026-09-21T14:32:05.000Z',
              },
              reason: {
                type: 'string',
                maxLength: 200,
                description: 'Usado em FAILED_ATTEMPT.',
                example: 'Cliente ausente',
              },
              receivedBy: {
                type: 'string',
                maxLength: 120,
                description: 'Usado em DELIVERED.',
                example: 'Maria Oliveira',
              },
            },
          },
        },
      },
      example: {
        events: [
          {
            clientEventId: '018f2e6e-9c1b-7c3a-9f2e-1a2b3c4d5e6f',
            deliveryId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
            type: 'DELIVERED',
            occurredAt: '2026-09-21T14:32:05.000Z',
            receivedBy: 'Maria Oliveira',
          },
        ],
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Resultado por item — inclui itens REJECTED, ainda assim 200.',
    schema: {
      type: 'object',
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              clientEventId: { type: 'string', format: 'uuid' },
              status: {
                type: 'string',
                enum: ['APPLIED', 'DUPLICATE', 'REJECTED'],
                example: 'APPLIED',
              },
              code: {
                type: 'string',
                nullable: true,
                enum: [
                  'DELIVERY_NOT_FOUND',
                  'DELIVERY_REASSIGNED',
                  'DELIVERY_CANCELLED',
                  'INVALID_STATUS_TRANSITION',
                ],
                description: 'Só presente quando status=REJECTED.',
              },
              delivery: {
                type: 'object',
                nullable: true,
                description:
                  'Estado atual da entrega, para reconciliação — presente em ' +
                  'APPLIED e na maioria dos REJECTED (ausente em DUPLICATE e em ' +
                  'DELIVERY_NOT_FOUND).',
              },
            },
          },
          example: [
            {
              clientEventId: '018f2e6e-9c1b-7c3a-9f2e-1a2b3c4d5e6f',
              status: 'APPLIED',
            },
            {
              clientEventId: '0f8fad5b-d9cb-469f-a165-70867728950e',
              status: 'DUPLICATE',
            },
            {
              clientEventId: '3d594650-3436-11e5-bf25-226b0e01f924',
              status: 'REJECTED',
              code: 'DELIVERY_CANCELLED',
              delivery: {
                id: '3d594650-3436-11e5-bf25-226b0e01f924',
                status: 'CANCELLED',
              },
            },
          ],
        },
      },
    },
  })
  @ApiResponse({
    status: 422,
    description:
      'Corpo inválido (Zod) — ex.: lote vazio, mais de 200 eventos, ids que não ' +
      'são UUID.',
    schema: zodValidationErrorSchema,
  })
  async handle(
    @Param('courierId') courierId: string,
    @Body(new ZodValidationPipe(pushEventsBodySchema)) body: PushEventsBody,
  ) {
    const result = await this.pushEvents.execute({
      courierId,
      events: body.events,
    })

    if (result.isLeft()) {
      throw useCaseErrorToHttp(result.value)
    }

    return {
      results: result.value.results.map((item) => ({
        clientEventId: item.clientEventId,
        status: item.status,
        code: item.code,
        delivery: item.delivery
          ? DeliveryPresenter.toHTTP(item.delivery)
          : undefined,
      })),
    }
  }
}
