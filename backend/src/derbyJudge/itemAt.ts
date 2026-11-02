/**
 * `items[index]` where the judge's own arithmetic keeps `index` in range, so reading past the list is a bug that fails
 * loudly instead of scoring with `undefined`.
 */
export function itemAt<Item>(items: readonly Item[], index: number): Item {
  const item = items[index]
  if (item === undefined) throw new RangeError(`No item at index ${index} of ${items.length}`)
  return item
}
