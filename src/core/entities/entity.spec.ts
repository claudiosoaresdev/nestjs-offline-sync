import { describe, expect, it } from 'vitest'

import { Entity } from '@/core/entities/entity'
import { UniqueEntityID } from '@/core/entities/unique-entity-id'

class Dummy extends Entity<{ label: string }> {
  static create(label: string, id?: UniqueEntityID) {
    return new Dummy({ label }, id)
  }
}

describe('Entity', () => {
  it('gera um id quando nenhum é informado', () => {
    expect(Dummy.create('a').id.toString()).toHaveLength(36)
  })

  it('é igual a outra instância com o mesmo id, mesmo com props diferentes', () => {
    const id = new UniqueEntityID()

    expect(Dummy.create('a', id).equals(Dummy.create('b', id))).toBe(true)
  })

  it('não é igual a uma entidade com id diferente', () => {
    expect(Dummy.create('a').equals(Dummy.create('a'))).toBe(false)
  })
})
