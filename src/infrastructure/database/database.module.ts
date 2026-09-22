import { Global, Module } from '@nestjs/common'

import { DeliveriesRepository } from '@/domain/delivery/application/repositories/deliveries-repository'
import { DeliveryChangesRepository } from '@/domain/delivery/application/repositories/delivery-changes-repository'
import { ProcessedDeliveryEventsRepository } from '@/domain/delivery/application/repositories/processed-delivery-events-repository'
import { ProductsRepository } from '@/domain/delivery/application/repositories/products-repository'
import { SyncStateRepository } from '@/domain/delivery/application/repositories/sync-state-repository'
import { InMemoryDeliveriesRepository } from '@/infrastructure/database/in-memory/in-memory-deliveries-repository'
import { InMemoryDeliveryChangesRepository } from '@/infrastructure/database/in-memory/in-memory-delivery-changes-repository'
import { InMemoryProcessedDeliveryEventsRepository } from '@/infrastructure/database/in-memory/in-memory-processed-delivery-events-repository'
import { InMemoryProductsRepository } from '@/infrastructure/database/in-memory/in-memory-products-repository'
import { InMemorySyncStateRepository } from '@/infrastructure/database/in-memory/in-memory-sync-state-repository'
import { seedProducts } from '@/infrastructure/database/in-memory/products.seed'

// Ponto único de binding de persistência:
// `{ provide: XRepository, useClass: PrismaXRepository }` — um por contrato de
// repositório, conforme os bounded contexts forem criados.
//
// ATENÇÃO: o binding de SyncStateRepository é `useExisting`, nunca `useClass`.
// InMemoryDeliveryChangesRepository recebe no construtor a classe concreta
// InMemorySyncStateRepository (precisa do `increment()` síncrono, que não
// existe no contrato). Se o contrato SyncStateRepository fosse registrado com
// `useClass: InMemorySyncStateRepository`, o Nest criaria uma SEGUNDA
// instância — quem injeta o contrato veria um contador de versão divergente
// do contador usado para gravar entradas no log de changes, e o
// `currentVersion` devolvido ao cliente deixaria de ter qualquer relação com
// as versões do log, em silêncio (sem erro, sem teste unitário pegando isso).
// `useExisting` garante que as duas chaves de DI apontam para a mesma
// instância singleton.
@Global()
@Module({
  providers: [
    InMemorySyncStateRepository,
    InMemoryDeliveryChangesRepository,
    InMemoryDeliveriesRepository,
    InMemoryProcessedDeliveryEventsRepository,
    {
      provide: InMemoryProductsRepository,
      useFactory: () => seedProducts(new InMemoryProductsRepository()),
    },
    { provide: SyncStateRepository, useExisting: InMemorySyncStateRepository },
    {
      provide: DeliveryChangesRepository,
      useExisting: InMemoryDeliveryChangesRepository,
    },
    {
      provide: DeliveriesRepository,
      useExisting: InMemoryDeliveriesRepository,
    },
    { provide: ProductsRepository, useExisting: InMemoryProductsRepository },
    {
      provide: ProcessedDeliveryEventsRepository,
      useExisting: InMemoryProcessedDeliveryEventsRepository,
    },
  ],
  exports: [
    SyncStateRepository,
    DeliveryChangesRepository,
    DeliveriesRepository,
    ProductsRepository,
    ProcessedDeliveryEventsRepository,
  ],
})
export class DatabaseModule {}
