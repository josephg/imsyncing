import { AtLeast1, LV, LVRange, Primitive, RawVersion, Pair } from "./types.js"
import { CausalGraph } from "./causal-graph.js"
import * as causalGraph from './causal-graph.js'
import bs from 'binary-search'
import assert from 'assert/strict'
import { assertSorted } from "./utils.js"
import { LMIndex, addIndex, checkIndex, entriesBetween, lookupIndex, removeIndex } from "./last-modified-index.js"

/** StateSet implements a simple CRDT set object with no history.
 *
 * Only the current set of values is stored.
 */
export interface StateSet<T=Primitive> {
  // ID -> [current value, current version] pairs.
  // NOTE: This is a MV register which only (always) stores primitive values.
  values: Map<LV, AtLeast1<Pair<T>>>,

  /**
   * This is an index to quickly find the items to send when syncing.
   * Each value exists in this list once for each version it has.
   *
   * The version here is the LV of the last time the key was modified.
   * Each key could show up multiple times if it currently has multiple values.
   * The list is sorted by v.
   */
  index: LMIndex,

  cg: CausalGraph,
}

export function create<T=Primitive>(): StateSet<T> {
  return {
    values: new Map(),
    index: [],
    cg: causalGraph.create(),
  }
}

export function hydrate<T>(values: StateSet<T>['values'], cg: CausalGraph): StateSet<T> {
  const index: StateSet<T>['index'] = []

  for (const [key, vals] of values) {
    for (const [lv, _] of vals) {
      index.push({lv, key})
    }
  }
  index.sort((a, b) => a.lv - b.lv)

  return { values, index, cg }
}

/** Set the key to a new value. The caller should create a new version for the operation, and pass that in. */
export function localSet<T>(crdt: StateSet<T>, version: RawVersion, key: LV | -1, value: T): LV {
  const lv = causalGraph.addRaw(crdt.cg, version)!.version
  if (key == -1) key = lv

  const oldPairs = crdt.values.get(key)
  crdt.values.set(key, [[lv, value]])

  if (oldPairs != null) {
    for (const [v, oldValue] of oldPairs) {
      // Remove from index
      removeIndex(crdt.index, v)
    }
  }

  crdt.index.push({lv: lv, key})

  return lv
}

/** Returns key of new item */
export function localInsert<T>(crdt: StateSet<T>, version: RawVersion, value: T): LV {
  return localSet(crdt, version, -1, value)
}

// *** Remote state ***
export type SSDelta<T=Primitive> = {
  cg: causalGraph.PartialSerializedCGV2,

  /**
   * This is a list of modified keys, in LV order.
   *
   * The vOffset is translated via the range in the cg delta.
   */
  ops: {
    vOffset: LV,
    /** Key modified. RawVersion because it might be outside the range. */
    key: RawVersion,
    /** New value. TODO: Deleting! */
    val: T
  }[]
}

export function deltaSince<T>(crdt: StateSet<T>, v: LV[] = []): SSDelta<T> {
  const ranges = causalGraph.diff(crdt.cg, v, crdt.cg.heads).bOnly
  // console.log('ranges', ranges)

  // const pairs = new Map<LV, Pair<T>[]>()
  const ops: SSDelta<T>['ops'] = []

  let offset = 0
  for (const [start, end] of ranges) {
    for (const {key, lv: v} of entriesBetween(crdt.index, start, end)) {
      // I could just add the data to ops, but this way we make sure to
      // only include the pairs within the requested range.

      // TODO: Add support for deleting DB entries.
      const pair = crdt.values.get(key)!.find(([v2]) => v2 === v)
      if (pair == null) throw Error('Invalid state!')
      const [lv, val] = pair
      ops.push({
        vOffset: lv - start + offset,
        key: causalGraph.lvToRaw(crdt.cg, key),
        val,
      })
    }

    offset += end - start
  }

  return {
    cg: causalGraph.serializeDiff(crdt.cg, ranges),
    ops
  }
}

function mergeSet<T>(crdt: StateSet<T>, key: LV, givenRawPairs: AtLeast1<Pair<T>>) {
  // const lv = causalGraph.addRaw(crdt.cg, version, 1, parents)

  // Editing the old list in-place.
  const pairs: Pair<T>[] = crdt.values.get(key) ?? []

  const oldVersions = pairs.map(([v]) => v)
  const newVersions = givenRawPairs.map(([v]) => v)

  causalGraph.findDominators2(crdt.cg, [...oldVersions, ...newVersions], (v, isDominator) => {
    // There's 3 options here: Its in old, its in new, or its in both.
    if (isDominator && !oldVersions.includes(v)) {
      // Its in new only. Add it!
      addIndex(crdt.index, v, key)

      const idx = newVersions.indexOf(v)
      if (idx < 0) throw Error('Invalid state')
      pairs.push([v, givenRawPairs[idx][1]])

    } else if (!isDominator && !newVersions.includes(v)) {
      // The item is in old only, and its been superceded. Remove it!
      removeIndex(crdt.index, v)
      const idx = pairs.findIndex(([v2]) => v2 === v)
      if (idx < 0) throw Error('Invalid state')
      pairs.splice(idx, 1)
    }
  })

  if (pairs.length < 1) throw Error('Invalid pairs - all removed?')
  crdt.values.set(key, pairs as AtLeast1<Pair<T>>)
}

export function mergeDelta<T>(crdt: StateSet<T>, delta: SSDelta<T>): LVRange {
  const startLV = causalGraph.nextLV(crdt.cg)

  // I'll gather the incoming data by key, and process each key one at a time.
  // This is a sparse list.
  const newPairs: AtLeast1<Pair<T>>[] = []

  // This code should also be correct.
  // const [start, end] = causalGraph.mergePartialVersions(crdt.cg, delta.cg)
  // const cgDeltaEnh = causalGraph.enhanceCGDiff(delta.cg)

  // for (const {vOffset, key: keyRaw, val} of delta.ops) {
  //   const lv = causalGraph.diffOffsetToMaybeLV(crdt.cg, start, cgDeltaEnh, vOffset)
  //   if (lv < 0) continue // We already have this delta.

  //   const key = causalGraph.rawToLV2(crdt.cg, keyRaw)

  //   if (newPairs[key] == null) newPairs[key] = [[lv, val]]
  //   else newPairs[key].push([lv, val])
  // }

  let offset = 0
  for (const entry of causalGraph.mergePartialVersions2(crdt.cg, delta.cg)) {
    let idx = bs(delta.ops, offset, (entry, needle) => entry.vOffset - needle)
    if (idx < 0) idx = -idx - 1 // Start at the next entry.

    for (; idx < delta.ops.length; idx++) {
      const {vOffset, key: keyRaw, val} = delta.ops[idx]

      const lv = vOffset - offset + entry.version
      if (lv >= entry.vEnd) break

      const key = causalGraph.rawToLV2(crdt.cg, keyRaw)

      if (newPairs[key] == null) newPairs[key] = [[lv, val]]
      else newPairs[key].push([lv, val])
    }

    offset += entry.vEnd - entry.version
  }

  newPairs.forEach((pairs, key) => {
    mergeSet(crdt, key, pairs)
  })

  // check(crdt)

  return [startLV, causalGraph.nextLV(crdt.cg)]
}

function check<T>(crdt: StateSet<T>) {
  let expectedIdxSize = 0

  for (const [key, pairs] of crdt.values.entries()) {
    assert(pairs.length >= 1)

    if (pairs.length >= 2) {
      const version = pairs.map(([v]) => v)

      // Check that all the versions are concurrent with each other.
      const dominators = causalGraph.findDominators(crdt.cg, version)
      assert.equal(version.length, dominators.length)

      assertSorted(version)
    }

    expectedIdxSize += pairs.length

    // Each entry should show up in the index.
    for (const [vv] of pairs) {
      assert.equal(key, lookupIndex(crdt.index, vv))
    }
  }

  checkIndex(crdt.index)
  assert.equal(expectedIdxSize, crdt.index.length)
}

export function get<T>(crdt: StateSet<T>, key: LV): T[] {
  const pairs = (crdt.values.get(key) ?? []) as Pair<T>[]

  return pairs.map(([_, val]) => val)
}

// ;(() => {
//   const crdt = create()
//   check(crdt)

//   // const agent = ['seph', 0]
//   const key1 = localInsert(crdt, ['seph', 0], "yooo")
//   console.log('key', key1)

//   const crdt2 = create()
//   console.dir(deltaSince(crdt), {depth: null})
//   mergeDelta(crdt2, deltaSince(crdt))
//   console.log('----')
//   console.dir(crdt, {depth:null})
//   console.dir(crdt2, {depth:null})
//   console.log('----')

//   const key2 = localInsert(crdt, ['seph', 1], "hiii")
//   console.log('key', key2)

//   const t1 = localSet(crdt, ['seph', 2], key1, "blah")
//   console.log(t1)

//   console.log(crdt)

//   console.log('heads', crdt2.cg.heads)
//   console.dir(deltaSince(crdt, [0]), {depth:null})

//   mergeDelta(crdt2, deltaSince(crdt, crdt2.cg.heads))
//   console.log('----')
//   console.dir(crdt, {depth:null})
//   console.dir(crdt2, {depth:null})
//   console.log('----')
//   assert.deepEqual(crdt, crdt2)
// })()

// ;(() => {
//   const crdt1 = create()

//   // const agent = ['seph', 0]
//   const key1 = localInsert(crdt1, ['seph', 0], "yooo")
//   const crdt2 = create()
//   mergeDelta(crdt2, deltaSince(crdt1))

//   // Ok, they're the same. Lets make concurrent changes to the key!
//   localSet(crdt1, ['a', 1], key1, 111)
//   localSet(crdt2, ['b', 1], key1, 222)

//   // Then share the changes both ways.
//   mergeDelta(crdt2, deltaSince(crdt1, [0]))
//   mergeDelta(crdt1, deltaSince(crdt2, [0]))

//   console.log('----')
//   console.dir(crdt1, {depth:null})
//   console.dir(crdt2, {depth:null})
//   console.log('----')

//   // They won't be deepEqual.
//   // assert.deepEqual(crdt, crdt2)
// })()