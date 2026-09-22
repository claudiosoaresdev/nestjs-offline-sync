import { Body, Controller, HttpCode, Post } from '@nestjs/common'
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { z } from 'zod'

import { CreateDeliveryUseCase } from '@/domain/delivery/application/use-cases/create-delivery'
import { useCaseErrorToHttp } from '@/infrastructure/http/controllers/errors/use-case-error-to-http'
import { DeliveryPresenter } from '@/infrastructure/http/presenters/delivery-presenter'
import { zodValidationErrorSchema } from '@/infrastructure/swagger/zod-validation-error.schema'
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

@ApiTags('deliveries')
@Controller('/deliveries')
export class CreateDeliveryController {
  constructor(private readonly createDelivery: CreateDeliveryUseCase) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Cria uma entrega e atribui a um entregador',
    description:
      'Cria a entrega em status PENDING, resolve cada item pelo `productId` ' +
      '(preço e nome vêm do catálogo no momento da criação) e emite change de ' +
      'domínio — a entrega aparece no próximo delta do entregador atribuído.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['courierId', 'customer', 'items'],
      properties: {
        courierId: {
          type: 'string',
          format: 'uuid',
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
          minItems: 1,
          items: {
            type: 'object',
            required: ['productId', 'quantity'],
            properties: {
              productId: {
                type: 'string',
                format: 'uuid',
                example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
              },
              quantity: { type: 'integer', minimum: 1, example: 3 },
            },
          },
        },
      },
      example: {
        courierId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        customer: {
          name: 'Maria Oliveira',
          phone: '+55 11 98888-7777',
          address: 'Rua das Acácias, 120 — São Paulo/SP',
        },
        items: [
          { productId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', quantity: 3 },
        ],
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Entrega criada',
    schema: {
      type: 'object',
      properties: {
        delivery: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            courierId: { type: 'string', format: 'uuid' },
            status: { type: 'string', example: 'PENDING' },
            attempts: { type: 'integer', example: 0 },
            customer: { type: 'object' },
            items: { type: 'array', items: { type: 'object' } },
            totalCents: { type: 'integer', example: 5970 },
            rating: { type: 'object', nullable: true, example: null },
            receivedBy: { type: 'string', nullable: true, example: null },
            deliveredAt: { type: 'string', nullable: true, example: null },
            revision: { type: 'integer', example: 1 },
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
      'RESOURCE_NOT_FOUND — algum productId do lote não existe no catálogo.',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string', example: 'RESOURCE_NOT_FOUND' },
        message: { type: 'string', example: 'Resource not found' },
      },
    },
  })
  @ApiResponse({
    status: 422,
    description:
      'Corpo inválido (Zod), ou INVALID_QUANTITY — quantidade solicitada excede o ' +
      'estoque do produto.',
    schema: {
      oneOf: [
        zodValidationErrorSchema,
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
