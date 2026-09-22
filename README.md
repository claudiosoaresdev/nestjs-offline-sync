# Delivery Sync API

API offline-first para entrega de produtos e avaliação de entrega, construída em
**NestJS + TypeScript** com **DDD e Clean Architecture**.

O tema central não é o CRUD de entregas — é o **protocolo de sincronização**: como
um app que passa o dia sem sinal baixa só o que mudou, envia o que fez em campo, e
converge com o servidor sem perder nem duplicar nada.

```
163 testes unitários · 5 testes e2e · 9 cenários de protocolo · 2 testes de arquitetura
```

---

## Por que este projeto existe

Ele começou como uma **análise de um sistema de delta sync em produção**. O modelo de
dados estava correto, mas o contrato da API tinha um defeito silencioso:

> O endpoint de mudanças truncava o lote no `limit` sem informar onde parou, e a
> documentação instruía o cliente a avançar o cursor para `currentVersion`.

Com 1200 mudanças e limite de 500, o cliente aplicava 500 e pulava o cursor para o
fim. **As outras 700 nunca mais eram entregues.** Sem erro, sem log, sem sintoma —
só um cache local errado para sempre.

Este projeto reimplementa o protocolo com esse e outros modos de falha tratados
explicitamente, e com testes que os reproduzem. Um exemplo real da suíte: ao simular
o comportamento antigo do cliente, o teste de convergência falha assim:

```
AssertionError: expected 10 to be 120
```

110 entregas perdidas em silêncio — capturadas em um teste que roda em 5ms.

---

## O protocolo

### Download: snapshot + delta

| Rota                                           | Uso                                         |
| ---------------------------------------------- | ------------------------------------------- |
| `GET /couriers/:courierId/deliveries/snapshot` | Carga inicial, paginada por cursor          |
| `GET /couriers/:courierId/deliveries/changes`  | Só o que mudou desde a última sincronização |

A resposta do delta carrega quatro campos que existem para fechar buracos reais:

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

- **`nextVersion`** — a maior versão **do lote**. O cliente avança para cá, nunca
  para `currentVersion`. É a correção do bug que originou o projeto.
- **`hasMore`** — ainda existe mudança acima do cursor; o cliente repete a chamada.
- **`minVersion`** — piso de retenção do log.
- **`resyncRequired`** — cursor velho demais ou adiantado (restore de backup). Nos
  dois casos o app refaz o snapshot em vez de divergir para sempre.

O lote é **compactado por entrega**: 20 mudanças do mesmo item viajam uma vez, com o
estado final. `REMOVE` é tombstone de escopo — a entrega saiu da carteira daquele
entregador, por cancelamento ou reatribuição.

### Upload: eventos do campo

| Rota                                          | Uso                                         |
| --------------------------------------------- | ------------------------------------------- |
| `POST /couriers/:courierId/deliveries/events` | Lote de eventos offline, resultado por item |

O entregador acumula eventos sem rede e sobe tudo de uma vez. Três realidades desse
cenário moldam a resposta:

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

- **Entrega é at-least-once** → idempotência por `clientEventId`; reenvio devolve
  `DUPLICATE` sem aplicar duas vezes.
- **Eventos chegam fora de ordem** → aplicados por `occurredAt` dentro de cada
  entrega.
- **O mundo mudou enquanto ele estava offline** → rejeição é **por item**, com código
  tipado e o **estado atual da entrega** para reconciliação imediata. Um evento velho
  nunca derruba o lote do dia inteiro.

### Operação e avaliação

| Rota                                  | Uso                                         |
| ------------------------------------- | ------------------------------------------- |
| `POST /deliveries`                    | Cria e atribui a um entregador              |
| `PATCH /deliveries/:deliveryId`       | Troca itens, cliente, reatribui ou cancela  |
| `POST /deliveries/:deliveryId/rating` | Destinatário avalia de 0 a 5 com comentário |

A avaliação fecha o ciclo: ela emite evento de domínio, entra no log, e aparece no
próximo delta do entregador.

---

## Arquitetura

```
src/
├── core/              TypeScript puro — Entity, ValueObject, AggregateRoot,
│                      Either, DomainEvents, WatchedList
├── domain/delivery/
│   ├── enterprise/    Agregado Delivery, Value Objects, eventos de domínio
│   └── application/   Use cases, contratos de repositório, erros tipados
└── infrastructure/    Controllers, presenters, repositórios, subscriber,
                       env, logger, health, rate limit, Swagger
```

**A regra de dependência aponta para dentro** e é verificada por teste automatizado:
`core` não conhece Nest, Prisma nem `infrastructure`; `domain` não conhece
`infrastructure`. Trocar a persistência in-memory por Prisma não toca um único use
case.

### A decisão de design mais importante

A regra de ouro de qualquer delta sync é _toda mudança de estado gera entrada no
log_. No sistema analisado, isso dependia de disciplina: existia um "writer service"
que todo mundo precisava lembrar de usar, e esquecer significava mudança invisível
para o cliente.

Aqui a garantia é **estrutural**:

```
Agregado muda de estado
  └─ emite Domain Event
       └─ Repositório persiste e SÓ ENTÃO despacha
            └─ Subscriber grava a entrada no log com versão monotônica
```

Não existe caminho que mude estado sem gerar change. Durante a implementação, três
bugs que furavam essa corrente foram encontrados e corrigidos em revisão — todos
passariam em teste de caminho feliz:

| Bug                                             | Efeito                                          |
| ----------------------------------------------- | ----------------------------------------------- |
| Getter devolvia referência mutável de `items`   | Estado mudava sem evento — invisível para o log |
| `save` despachava eventos mesmo sem gravar      | Log ganhava entrada para entrega inexistente    |
| Compactação dependia de ordenação não declarada | Cursor avançaria além do entregue, em silêncio  |

---

## Qualidade

| Camada              | O que cobre                                                             |
| ------------------- | ----------------------------------------------------------------------- |
| **Unit** (163)      | Agregado, Value Objects, use cases, repositórios, subscriber, presenter |
| **Protocolo** (9)   | Convergência, resync, compactação, escopo por ator, idempotência        |
| **E2E** (5)         | Ciclo completo via HTTP, com supertest                                  |
| **Arquitetura** (2) | Regra de dependência entre camadas                                      |

Os cenários de protocolo simulam um **cliente de referência** que aplica o delta como
um app real aplicaria — mantendo cache local, iterando por `nextVersion` enquanto
`hasMore` for verdadeiro — e exigem convergência exata com o servidor.

Dois testes foram validados por experimento, quebrando o código de propósito para
confirmar que acusam a falha:

- trocar `useExisting` por `useClass` no container → teste de identidade de instância
  falha (evita dois contadores de versão divergindo em silêncio)
- cliente avançando para `currentVersion` → cenário de convergência falha com
  `expected 10 to be 120`

---

## Como rodar

```bash
npm ci
npm run start:dev      # http://localhost:3333 — Swagger em /docs
```

```bash
npm test               # unit + protocolo + arquitetura
npm run test:e2e       # ciclo completo via HTTP
npm run test:cov       # cobertura
```

Persistência é **in-memory**: reiniciar zera os dados, e produtos entram por seed.
A decisão é deliberada — o foco do projeto é o protocolo, e os contratos de
repositório vivem no domínio justamente para que a troca por um banco real seja
mecânica.

---

## Stack

**NestJS 11** · **TypeScript** (strict onde importa, `@/` como alias) · **Zod** na
validação de borda · **Vitest** (configs separadas para unit e e2e, SWC) ·
**Swagger** · **pino** · **Terminus** (health) · **Throttler** (rate limit)

Qualidade de código: ESLint flat config com `simple-import-sort` e proibição de
import relativo · Prettier · Husky + lint-staged · commitlint (Conventional Commits)
· Commitizen.

---

## Fora de escopo (por decisão, não por esquecimento)

Prisma + Postgres · autenticação JWT · SSE para painel da operação · prova de entrega
com foto · poda do log com `minVersion` ativo.

Cada um tem lugar reservado no desenho: os contratos de repositório já isolam a
persistência, o `minVersion` já trafega na resposta, e o `DatabaseModule` já é o ponto
único de binding.

---

## Documentação

- [Spec de design](docs/superpowers/specs/2026-09-21-api-entregas-delta-sync-design.md)
  — decisões, alternativas descartadas e a tabela de bugs que originou cada requisito
- [Plano de implementação](docs/superpowers/plans/2026-09-21-api-entregas-delta-sync.md)
  — 21 tasks em TDD, com código e critério de verificação por passo
