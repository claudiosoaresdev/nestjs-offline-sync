export abstract class WatchedList<T> {
  protected currentItems: T[]
  private initial: T[]
  private newItems: T[]
  private removedItems: T[]

  protected constructor(initialItems?: T[]) {
    this.currentItems = initialItems ? [...initialItems] : []
    this.initial = initialItems ? [...initialItems] : []
    this.newItems = []
    this.removedItems = []
  }

  abstract compareItems(a: T, b: T): boolean

  public getItems(): readonly T[] {
    return this.currentItems
  }

  public getNewItems(): readonly T[] {
    return this.newItems
  }

  public getRemovedItems(): readonly T[] {
    return this.removedItems
  }

  public add(item: T): void {
    this.removedItems = this.reject(this.removedItems, item)

    if (
      !this.contains(this.newItems, item) &&
      !this.contains(this.initial, item)
    ) {
      this.newItems.push(item)
    }

    if (!this.contains(this.currentItems, item)) {
      this.currentItems.push(item)
    }
  }

  public remove(item: T): void {
    this.currentItems = this.reject(this.currentItems, item)

    if (this.contains(this.newItems, item)) {
      this.newItems = this.reject(this.newItems, item)
      return
    }

    if (!this.contains(this.removedItems, item)) {
      this.removedItems.push(item)
    }
  }

  private contains(items: T[], item: T): boolean {
    return items.some((candidate) => this.compareItems(candidate, item))
  }

  private reject(items: T[], item: T): T[] {
    return items.filter((candidate) => !this.compareItems(candidate, item))
  }
}
