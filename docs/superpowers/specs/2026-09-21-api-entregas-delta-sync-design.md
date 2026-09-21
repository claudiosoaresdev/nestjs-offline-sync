# API de Entregas com Delta Sync — Design

**Data:** 2026-09-21
**Projeto:** `nestjs-offline-sync`
**Status:** aprovado, pronto para plano de implementação

## Objetivo

API offline-first para entrega de produtos e qualificação da entrega. O app do
entregador mantém sua carteira de entregas em cache local, trabalha em campo sem
sinal e sincroniza quando a rede volta. O destinatário avalia a entrega depois,
online, com nota de 0 a 5 e comentário.

O projeto é de portfólio. O valor demonstrado é o **protocolo de sincronização**:
snapshot + delta sync no download, escrita offline idempotente no upload, e os
modos de falha desse protocolo tratados explicitamente.

## Contexto e origem

Este design nasce da análise do repositório
[`claudiosoaresdev/nest-offline-sync`](https://github.com/claudiosoaresdev/nest-offline-sync),
que implementa delta sync para um catálogo de produtos. O modelo de dados dele
está correto; os problemas estão na borda do contrato e na concorrência. Cada um
vira requisito explícito aqui:

| Problema no projeto de origem                                                                                                                                                                            | Requisito neste design                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `/catalog/changes` trunca em `limit` sem dizer onde parou, e a doc manda o cliente avançar para `currentVersion` — o que descarta silenciosamente todas as mudanças entre o fim do lote e a versão atual | Resposta carrega `nextVersion` e `hasMore`; o cliente avança para `nextVersion`, nunca para `currentVersion` |
| Sequence do Postgres atribui a versão no INSERT, mas commits ordenam diferente: uma leitura na janela entre dois commits enxerga a versão maior e não a menor, deixando a menor órfã para sempre         | Versão atribuída em seção crítica, **após** a entrega estar salva                                            |
| Sem piso de retenção: cliente com cursor antigo demais receberia delta parcial em silêncio                                                                                                               | Resposta carrega `minVersion`; abaixo dele, `resyncRequired: true`                                           |
| `sinceVersion >= currentVersion` trata "em dia" e "adiantado" como o mesmo caso; cliente adiantado nunca mais converge                                                                                   | Cursor adiantado dispara `resyncRequired: true`                                                              |
| Sem compactação: N mudanças da mesma entidade viajam N vezes, todas com o mesmo estado atual                                                                                                             | Lote compactado por `deliveryId`, mantendo a maior versão                                                    |
| Teto de `limit` alto com payload inteiro embutido                                                                                                                                                        | Teto conservador, seguro por causa do `hasMore`                                                              |

Referências de arquitetura: `🧠 Knowledge/Software Development/Backend Development/NestJS/NestJS Architecture Reference.md`
(DDD + Clean Architecture) e o projeto irmão
`nestjs-orchestrator-video-processing-platform`, cujas convenções de arquivo,
nomenclatura e teste este projeto já segue.

## Decisões

**Persistência in-memory.** Sem Prisma, sem Postgres. Os contratos de
repositório vivem no domínio; as implementações em memória ficam em
`infrastructure/database/in-memory/`. Trocar por Prisma depois não toca nenhum
use case.

**Produtos são pré-cadastrados.** A API não tem escrita de catálogo. Produtos
entram por seed em memória e são referenciados pelos itens da entrega.

**Um único bounded context**, `delivery`.

**Log global com destinatário no registro.** Uma sequência `version` única para
todas as entregas; cada `DeliveryChange` carrega o `courierId` a quem a mudança
pertence. A consulta filtra por courier e `version > sinceVersion`.

_Alternativas descartadas:_ sequência por entregador (cursores menores, mas exige
um contador por courier e deixa a reatribuição escrevendo em dois streams sem
ordem definida entre eles); consulta por `updatedAt` (não enxerga remoção, não
distingue duas mudanças da mesma entidade, quebra com empate de timestamp — é o
anti-padrão que o change log existe para resolver).

**Domain Events escrevem o log.** O agregado acumula o evento ao mudar de
estado, o repositório despacha pós-save, e um subscriber em
`infrastructure/events/` traduz evento de domínio em entrada do log. A regra de
ouro do delta sync — _toda mudança gera change_ — deixa de depender de
disciplina de quem escreve o código e passa a ser consequência do agregado.

_Limitação aceita:_ append e save não são atômicos. Em memória, processo único,
a janela é desprezível. Com banco real, os dois passam para a mesma transação
(outbox).

**Identidade simples.** `courierId` na rota, avaliação sem token. Auth é roadmap.

## Domínio

### Agregado `Delivery`

Raiz do agregado. Estado: `courierId`, `customer` (VO), `items`
(`DeliveryItem[]` com `productId`, `quantity` e snapshot de nome e preço no
momento da atribuição), `status`, `attempts`, `rating` (VO, opcional),
`revision`, `createdAt`, `updatedAt`.

Métodos, todos validando invariante e retornando `Either<DomainError, null>`:

| Método                                      | Regra                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------- |
| `assignTo(courierId)`                       | Reatribuição; emite evento com courier anterior e novo                |
| `markOutForDelivery()`                      | Só de `PENDING`                                                       |
| `registerFailedAttempt(reason, occurredAt)` | Só de `OUT_FOR_DELIVERY`; incrementa `attempts`, volta para `PENDING` |
| `markDelivered(receivedBy, occurredAt)`     | Só de `OUT_FOR_DELIVERY`                                              |
| `cancel(reason)`                            | De qualquer estado não terminal                                       |
| `changeItems(items)`                        | Bloqueado em entrega terminal                                         |
| `changeCustomer(customer)`                  | Bloqueado em entrega terminal                                         |
| `rate(score, comment)`                      | Só em `DELIVERED`, e só uma vez                                       |

Sem setter público. Construção só por `static create()`.

### Máquina de estados

```text
PENDING ──markOutForDelivery──> OUT_FOR_DELIVERY ──markDelivered──> DELIVERED
   ^                                   │
   └────registerFailedAttempt──────────┘

PENDING | OUT_FOR_DELIVERY ──cancel──> CANCELLED
```

`DELIVERED` e `CANCELLED` são terminais. Tentativa falha **volta para
`PENDING`** — a entrega é reagendada, não encerrada.

### Value Objects

- **`DeliveryStatus`** — guarda as transições permitidas; `canTransitionTo` é a
  única fonte de verdade da máquina de estados.
- **`RatingScore`** — inteiro de 0 a 5; `create` retorna `Either`.
- **`CustomerInfo`** — nome, telefone, endereço. Igualdade por valor é o que
  detecta "informação do cliente mudou" sem comparar campo a campo.
- **`Quantity`** — inteiro positivo.

### Eventos de domínio

`DeliveryCreatedEvent`, `DeliveryAssignedEvent` (carrega `previousCourierId` e
`courierId`), `DeliveryStatusChangedEvent`, `DeliveryDetailsChangedEvent`,
`DeliveryRatedEvent`, `DeliveryCancelledEvent`.

### Entidade `DeliveryChange`

`version` (global, monótona), `type` (`UPSERT` | `REMOVE`), `deliveryId`,
`courierId`, `occurredAt`.

`REMOVE` é tombstone de escopo, não delete de dado: a entrega saiu da carteira
daquele courier (cancelada ou reatribuída). Reatribuição gera **duas** entradas:
`REMOVE` para o courier anterior e `UPSERT` para o novo.

## Contratos HTTP

### `GET /couriers/:courierId/deliveries/snapshot`

Query: `limit` (default 100, max 500), `cursor` (id da última entrega da página
anterior), `withTotal`.

Resposta: `currentVersion`, `totalItems` (só com `withTotal`), `items`,
`nextCursor`.

Ordenação fixa por `id` ascendente, cursor estável, busca `limit + 1` para
detectar página seguinte.

**Protocolo do cliente:** salvar `baseVersion = currentVersion` da **primeira**
página, paginar até `nextCursor` sumir, e então chamar o delta com
`sinceVersion = baseVersion` para capturar o que mudou durante a paginação.

### `GET /couriers/:courierId/deliveries/changes`

Query: `sinceVersion` (obrigatório, ≥ 0), `limit` (default 200, max 500).

```json
{
  "currentVersion": 4200,
  "nextVersion": 3500,
  "hasMore": true,
  "minVersion": 0,
  "resyncRequired": false,
  "changes": [
    { "type": "UPSERT", "version": 3498, "deliveryId": "…", "delivery": {} },
    { "type": "REMOVE", "version": 3500, "deliveryId": "…" }
  ]
}
```

Semântica de cada campo:

- **`nextVersion`** — maior `version` do lote. É para onde o cliente move o
  cursor. Quando o lote vem vazio, é igual a `sinceVersion`.
- **`hasMore`** — existem mudanças acima de `nextVersion`. O cliente repete a
  chamada enquanto for `true`.
- **`minVersion`** — piso de retenção do log. Hoje sempre `0` porque o log não é
  podado; o campo existe para o cliente não precisar mudar quando a poda entrar.
- **`resyncRequired`** — `true` quando `sinceVersion < minVersion` (cursor velho
  demais) ou `sinceVersion > currentVersion` (cliente adiantado, caso de restore
  ou reset de seed). Nos dois casos `changes` vem vazio e o app refaz o snapshot.
- **`changes`** — ordenado por `version` ascendente, **compactado por
  `deliveryId`** mantendo só a maior versão. `UPSERT` carrega a entrega inteira,
  então o apply é last-write-wins e não depende de aplicar o histórico.

A compactação acontece **depois** do corte por `limit`, sobre a janela lida —
assim `nextVersion` continua sendo o maior `version` realmente coberto pelo lote
e nenhuma mudança fica entre o cursor novo e o que foi entregue.

### `POST /couriers/:courierId/deliveries/events`

Lote de eventos do campo. Cada item: `clientEventId` (UUID do aparelho),
`deliveryId`, `type` (`OUT_FOR_DELIVERY` | `FAILED_ATTEMPT` | `DELIVERED`),
`occurredAt` (relógio do dispositivo) e payload do tipo (`reason` para tentativa
falha, `receivedBy` para entrega).

```json
{
  "results": [
    { "clientEventId": "…", "status": "APPLIED" },
    { "clientEventId": "…", "status": "DUPLICATE" },
    {
      "clientEventId": "…",
      "status": "REJECTED",
      "code": "DELIVERY_CANCELLED",
      "delivery": {}
    }
  ]
}
```

- **`APPLIED`** — evento mudou o estado do agregado.
- **`DUPLICATE`** — `clientEventId` já processado. Retry de rede é gratuito;
  entrega é at-least-once por definição.
- **`REJECTED`** — carrega `code` tipado e **o estado atual da entrega**, para o
  app reconciliar sem segunda chamada. Códigos: `DELIVERY_NOT_FOUND`,
  `DELIVERY_CANCELLED`, `DELIVERY_REASSIGNED`, `INVALID_STATUS_TRANSITION`,
  `DELIVERY_ALREADY_FINALIZED`.

O lote **nunca** falha inteiro por causa de um item: um evento velho rejeitado
não pode travar a sincronização do dia. Eventos do mesmo `deliveryId` são
aplicados em ordem de `occurredAt`; entre entregas diferentes, na ordem do array.

A resposta HTTP é 200 mesmo com itens rejeitados — rejeição é resultado de
negócio, não erro de transporte.

### `POST /deliveries/:deliveryId/rating`

Body: `score` (inteiro 0–5), `comment` (string opcional, até 500 caracteres).

Aceita só em entrega `DELIVERED` (senão 409 `DELIVERY_NOT_DELIVERED`) e só uma
vez por entrega (409 `RATING_ALREADY_EXISTS`). `score` fora da faixa é 422 pelo
Zod, antes de chegar ao domínio.

Aplicada, emite `DeliveryRatedEvent` → subscriber faz append → a entrega entra no
próximo delta do entregador já com nota e comentário.

### Operação

`POST /deliveries` cria e atribui. `PATCH /deliveries/:deliveryId` altera itens,
dados do cliente, reatribui ou cancela. É o lado que produz os `UPSERT` e
`REMOVE` que o app do entregador consome.

## Estrutura de arquivos

```text
src/domain/delivery/
├── enterprise/
│   ├── entities/          delivery.ts, delivery-item.ts, product.ts,
│   │                      delivery-change.ts, delivery-status.ts,
│   │                      rating-score.ts, customer-info.ts, quantity.ts
│   └── events/            delivery-created.event.ts, delivery-assigned.event.ts,
│                          delivery-status-changed.event.ts,
│                          delivery-details-changed.event.ts,
│                          delivery-rated.event.ts, delivery-cancelled.event.ts
└── application/
    ├── repositories/      deliveries-repository.ts,
    │                      delivery-changes-repository.ts,
    │                      sync-state-repository.ts, products-repository.ts
    └── use-cases/         pull-delivery-changes.ts, get-delivery-snapshot.ts,
                           push-delivery-events.ts, rate-delivery.ts,
                           create-delivery.ts, update-delivery.ts,
                           + um arquivo por erro tipado

src/infrastructure/
├── database/in-memory/    um repositório por contrato
├── events/                append-delivery-change.subscriber.ts
└── http/
    ├── controllers/       um controller por caso de uso
    └── presenters/        delivery-presenter.ts, delivery-change-presenter.ts
```

Value Objects ficam em `enterprise/entities/`, seguindo o projeto irmão (o doc do
vault os coloca em `value-objects/`; a convenção do código real prevalece).

Nenhum `@Module` dentro de `domain/`: controllers e use cases entram no
`HttpModule`, bindings de repositório no `DatabaseModule` (`@Global`), o
subscriber é provider registrado no `HttpModule`.

## Atribuição de versão

O `SyncState` guarda `currentVersion`. O append ao log é serializado: incremento
e escrita acontecem em seção crítica, e a versão é atribuída **depois** de a
entrega estar salva.

Isso fecha, já em memória, a race que o projeto de origem tem em Postgres. Ao
migrar para banco real, a serialização vira advisory lock por bounded context ou
leitura por watermark (só expor versões abaixo da transação aberta mais antiga).
É decisão de arquitetura, não detalhe de implementação.

## Tratamento de erros

Erros de domínio são tipados, retornados em `Either`, nunca lançados. A tradução
para HTTP acontece só em `useCaseErrorToHttp`:

| Erro                            | HTTP | `code`                       |
| ------------------------------- | ---- | ---------------------------- |
| `DeliveryNotFoundError`         | 404  | `DELIVERY_NOT_FOUND`         |
| `CourierMismatchError`          | 403  | `COURIER_MISMATCH`           |
| `InvalidStatusTransitionError`  | 409  | `INVALID_STATUS_TRANSITION`  |
| `DeliveryAlreadyFinalizedError` | 409  | `DELIVERY_ALREADY_FINALIZED` |
| `DeliveryNotDeliveredError`     | 409  | `DELIVERY_NOT_DELIVERED`     |
| `RatingAlreadyExistsError`      | 409  | `RATING_ALREADY_EXISTS`      |
| `InvalidRatingScoreError`       | 422  | `INVALID_RATING_SCORE`       |

No push em lote esses mesmos erros **não** viram status HTTP: viram `REJECTED`
com o `code` correspondente, dentro de um 200.

Validação de shape na borda é Zod via `ZodValidationPipe`, que já existe. Zod
valida formato; Value Object valida invariante de domínio. Os dois convivem.

## Estratégia de testes

Vitest, já configurado: unit em `src/**/*.spec.ts`, e2e em
`test/e2e/**/*.e2e-spec.ts`.

**Unit de domínio** — cada transição válida e inválida da máquina de estados;
`FAILED_ATTEMPT` incrementando `attempts` e voltando para `PENDING`;
`RatingScore` rejeitando `-1`, `6` e `3.5`; `CustomerInfo` igual por valor;
alteração de itens bloqueada em entrega terminal.

**Unit de use case** — repositórios in-memory como test double (padrão do projeto
irmão), nunca mock do Prisma.

**Unit do subscriber** — uma mudança no agregado gera exatamente uma entrada no
log, com o courier certo; reatribuição gera o par `REMOVE` + `UPSERT`.

**Testes do protocolo de sync** — o núcleo do portfólio. Um arquivo dedicado,
cobrindo:

1. Delta truncado não perde mudança: 1200 mudanças, `limit` 200, cliente itera
   por `nextVersion` até `hasMore` ser falso e termina com o mesmo estado do
   servidor. É o cenário que o projeto de origem perde em silêncio.
2. Cursor adiantado (`sinceVersion > currentVersion`) devolve `resyncRequired`.
3. Cursor abaixo de `minVersion` devolve `resyncRequired`.
4. Compactação: 20 mudanças da mesma entrega viram um `UPSERT` no lote.
5. Janela do snapshot: mudança ocorrida durante a paginação é capturada pelo
   delta com `sinceVersion = baseVersion`.
6. Escopo por ator: entrega de outro courier nunca aparece no delta.
7. Reatribuição: courier antigo recebe `REMOVE`, novo recebe `UPSERT`.
8. Push idempotente: mesmo `clientEventId` duas vezes → `APPLIED` e `DUPLICATE`,
   com um único efeito no agregado.
9. Push parcial: um item rejeitado não impede os demais de serem aplicados.

**E2E** — ciclo completo com supertest contra a app real: snapshot → operação
altera a carteira → delta → push do campo → avaliação → delta de novo mostrando a
nota.

**Regra de dependência** — `test/architecture/dependency-rule.spec.ts` já existe e
passa a valer de verdade quando `src/domain/` deixar de estar vazio: `core` sem
Nest e sem Prisma, `domain` sem imports de `infrastructure`.

## Fora de escopo (roadmap)

Prisma + Postgres + Docker Compose. Auth JWT do entregador e token de uso único
para avaliação. SSE para o painel da operação. Prova de entrega com foto ou
assinatura (upload binário, fila e storage). Poda do log com `minVersion` ativo.
Cadastro de produtos.

## Critérios de sucesso

1. Um cliente que aplica o delta seguindo o protocolo especificado converge para
   o mesmo estado do servidor, mesmo com o lote truncado — verificado por teste.
2. Push repetido não duplica efeito; push conflitante rejeita só o item afetado e
   devolve estado suficiente para reconciliar.
3. Nenhuma mudança de entrega existe sem entrada correspondente no log.
4. `src/domain/` não importa Nest, Prisma ou `infrastructure`.
5. Lint, format, build, unit e e2e limpos.
