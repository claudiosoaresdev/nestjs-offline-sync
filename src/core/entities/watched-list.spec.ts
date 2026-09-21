import { beforeEach, describe, expect, it } from 'vitest'

import { WatchedList } from '@/core/entities/watched-list'

class NumberList extends WatchedList<number> {
  static create(initial?: number[]) {
    return new NumberList(initial)
  }

  compareItems(a: number, b: number): boolean {
    return a === b
  }
}

let list: NumberList

describe('WatchedList', () => {
  beforeEach(() => {
    list = NumberList.create([1, 2, 3])
  })

  it('marca como novo só o que não estava na lista inicial', () => {
    list.add(4)
    list.add(1)

    expect(list.getNewItems()).toEqual([4])
    expect(list.getItems()).toEqual([1, 2, 3, 4])
  })

  it('marca como removido só o que estava na lista inicial', () => {
    list.add(4)
    list.remove(4)
    list.remove(2)

    expect(list.getNewItems()).toEqual([])
    expect(list.getRemovedItems()).toEqual([2])
    expect(list.getItems()).toEqual([1, 3])
  })

  it('readicionar um item removido cancela a remoção', () => {
    list.remove(2)
    list.add(2)

    expect(list.getRemovedItems()).toEqual([])
    expect(list.getNewItems()).toEqual([])
    expect(list.getItems()).toEqual([1, 3, 2])
  })
})
