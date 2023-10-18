// This is a simple data structure which allows a big complex object to be queried for what has
// changed since some point in time. (LV).
//
// The current implementation is pretty inefficient since it involves splicing out items from an
// array. It would be better to use a tree or something.

import bs from 'binary-search'
import { LV } from "./types.js"
import { assertSorted, assertSortedCustom } from './utils.js'

/**
 * Each value exists in this list once for each version it has.
 *
 * The same key may appear multiple times in the index.
 *
 * The index is always sorted by LV. The same LV may appear multiple
 * times in the index - eg if a new CRDT is created in a DbEntry. In this
 * case the order of those entries in the index is undefined.
 */
export type LMIndex<Fields = {key: LV}> = (Fields & {lv: LV})[]

function rawLookup<F>(index: LMIndex<F>, v: LV): number {
  return bs(index, v, (entry, needle) => entry.lv - needle)
}

export function removeIndex<F>(index: LMIndex<F>, v: LV) {
  const idx = rawLookup(index, v)
  if (idx < 0) throw Error('Missing old version in index')

  // Splice the entry out. The entry will usually be near the end, so this is
  // not crazy slow.
  index.splice(idx, 1)
}

export function addIndex<F>(index: LMIndex<F>, entry: F & {lv: LV}) {
  if (index.length == 0 || index[index.length - 1].lv < entry.lv) {
    // Normal, fast case.
    index.push(entry)
  } else {
    const idx = rawLookup(index, entry.lv)
    if (idx >= 0) return // Already indexed.
    const insIdx = -idx - 1
    index.splice(insIdx, 0, entry)
  }
}

export function lookupIndex<F>(index: LMIndex<F>, v: LV): (F & {lv: LV}) | null {
  const result = rawLookup(index, v)

  return result < 0 ? null
    : index[result]
}

/**
 * Yield the entries ({lv, k}) since the specified time. They will be yielded in time order.
 * The keys will not be uniq'd.
 */
export function *entriesBetween<F>(index: LMIndex<F>, start: LV, end: LV = -1): Iterable<LMIndex<F>[0]> {
  let idx = rawLookup(index, start)
  if (idx < 0) idx = -idx - 1

  for (; idx < index.length; idx++) {
    if (end >= 0 && index[idx].lv >= end) break
    yield index[idx]
  }
}

// /** Get a list of the keys which have been modified in the range of `[since..]` */
// export function modifiedKeysSince<F>(index: LMIndex<F>, since: LV): Set<F> {
//   const result = new Set<F>() // To uniq() the results.
//   for (const {key} of entriesBetween(index, since)) {
//     result.add(key)
//   }
//   return result
// }

export function checkIndex<F>(index: LMIndex<F>) {
  // Make sure the index is sorted.
  assertSortedCustom(index, e => e.lv)
}