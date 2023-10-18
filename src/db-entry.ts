// This file contains methods & tools to interact with database entries.
// This code was stolen & modified from the DbEntry code in replca's JS implementation.

import { CRDTValue, CRDTMapValue, MapKey, CreateValue, DbEntry, LV, MVRegister, Op, Pair, Primitive, ROOT_LV, RawVersion, RegisterValue, LVRange } from "./types.js"
import * as causalGraph from './causal-graph.js'
import { assertSortedCustom, errExpr } from "./utils.js"
import { addIndex, entriesBetween, removeIndex } from "./last-modified-index.js"
import { Console } from "node:console"

export const createDbEntry = (appType: string, storesHistory: boolean = false): DbEntry => {
  if (storesHistory) throw Error('Storing history is NYI.')

  return {
    crdts: new Map<LV, CRDTValue>([
      // CRDTs start with a root CRDT object entry.
      [ ROOT_LV, { type: 'map', registers: new Map() } ]
    ]),
    cg: causalGraph.create(),
    index: [],
    storesHistory,
    branch: [],
    nextSeq: 0,
    appType,
  }
}

export function hydrateIndex(entry: DbEntry) {
  entry.index.length = 0

  for (const [key, info] of entry.crdts) {
    switch (info.type) {
      case 'register': {
        for (const [lv, _] of info.value) {
          entry.index.push({lv, key, mapKey: null})
        }
        break
      }
      case 'map': {
        for (const [mapKey, reg] of info.registers) {
          for (const [lv, _] of reg) {
            entry.index.push({lv, key, mapKey})
          }
        }
        break
      }
    }
  }
  entry.index.sort((a, b) => a.lv - b.lv)
}

const nextVersion = (entry: DbEntry, agent: string): RawVersion => ([agent, entry.nextSeq++])

function removeRecursive(entry: DbEntry, [lv, val]: Pair<RegisterValue>) {
  if (val.type !== 'crdt') return

  const crdt = entry.crdts.get(lv)
  if (crdt == null) return

  switch (crdt.type) {
    case 'map':
      for (const [k, reg] of crdt.registers) {
        for (const pair of reg) {
          removeRecursive(entry, pair)
        }
      }
      break
    case 'register':
      for (const pair of crdt.value) {
        removeRecursive(entry, pair)
      }
      break
    // case 'set':
    //   for (const [id, value] of crdt.values) {
    //     removeRecursive(entry, value)
    //   }
    //   break
    // case 'stateset':
    //   throw Error('Cannot remove from a stateset')
      
    default: throw Error('Unknown CRDT type!?')
  }

  entry.crdts.delete(lv)
}

function createCRDT(entry: DbEntry, id: LV, type: 'map' | 'set' | 'register' | 'stateset') {
  if (entry.crdts.has(id)) {
    throw Error('CRDT already exists !?')
  }

  const crdtInfo: CRDTValue = type === 'map' ? {
    type: "map",
    registers: new Map,
  } : type === 'register' ? {
    type: 'register',
    // Registers default to NULL when created.
    value: [[id, {type: 'primitive', val: null}]],
  // } : type === 'set' ? {
  //   type: 'set',
  //   values: new Map,
  // } : type === 'stateset' ? {
  //   type: 'stateset',
  //   values: new Map,
  } : errExpr('Invalid CRDT type')

  entry.crdts.set(id, crdtInfo)

  addIndex(entry.index, {lv: id, key: id, mapKey: null})
}

const getMap = (entry: DbEntry, mapId: LV): CRDTMapValue => {
  const crdt = entry.crdts.get(mapId)
  if (crdt == null || crdt.type !== 'map') throw Error('Invalid CRDT')
  return crdt
}


// function mergeRegister(entry: DbEntry, globalParents: LV[], oldPairs: Pair<RegisterValue>[], localParents: LV[], newVersion: LV, newVal: CreateValue): MVRegister {
//   let newValue: RegisterValue
//   if (newVal.type === 'primitive') {
//     newValue = newVal
//   } else {
//     // Create it.
//     createCRDT(entry, newVersion, newVal.crdtKind)
//     newValue = {type: "crdt", id: newVersion}
//   }

//   const newPairs: MVRegister = [[newVersion, newValue]]
//   for (const [version, value] of oldPairs) {
//     // Each item is either retained or removed.
//     if (localParents.some(v2 => version === v2)) {
//       // The item was named in parents. Remove it.
//       // console.log('removing', value)
//       removeRecursive(entry, value)
//     } else {
//       // We're intending to retain this operation because its not explicitly
//       // named, but that only makes sense if the retained version is concurrent
//       // with the new version.
//       if (causalGraph.versionContainsLV(entry.cg, globalParents, version)) {
//         throw Error('Invalid local parents in operation')
//       }

//       newPairs.push([version, value])
//     }
//   }

//   // Note we're sorting by *local version* here. This doesn't sort by LWW
//   // priority. Could do - currently I'm figuring out the priority in the
//   // get() method.
//   newPairs.sort(([v1], [v2]) => v1 - v2)

//   return newPairs
// }

// function mergeRegistersSlow(cg: causalGraph.CausalGraph, allPairs: MVRegister): MVRegister {
//   // This is a wee bit inefficient. Hopefully the fast paths below will catch most cases.
//   const versions = allPairs.map(([v]) => v)
//   const dominators = causalGraph.findDominators(cg, versions)
//   const result = allPairs.filter(([version, _]) => dominators.includes(version))
//   if (result.length < 1) throw Error('Invalid pairs - all removed?')
//   return result as MVRegister
// }

// function mergeRegister(cg: causalGraph.CausalGraph, oldPairs: Pair<RegisterValue>[], newPairs: MVRegister): MVRegister {
//   // Fast path, because fewer allocations is better.
//   if (oldPairs.length === 0) return newPairs // Assuming newPairs is reduced already.
//   if (oldPairs.length === 1 && newPairs.length === 1) {
//     if (newPairs[0][0] === oldPairs[0][0]) return oldPairs as MVRegister
//     const cmp = causalGraph.compareVersions(cg, oldPairs[0][0], newPairs[0][0])
//     return cmp === 0 ? [oldPairs[0], newPairs[0]]
//       : cmp < 0 ? oldPairs as MVRegister
//       : newPairs
//   }

//   return mergeRegistersSlow(cg, [...oldPairs, ...newPairs] as MVRegister)
// }

// /** Same as mergeRegister above, but with the new pairs replaced with a single version / value arguments */
// function mergeRegister2(cg: causalGraph.CausalGraph, oldPairs: Pair<RegisterValue>[], newVersion: LV, newVal: RegisterValue): MVRegister {
//   // Fast path.
//   if (oldPairs.length === 0) return [[newVersion, newVal]] // Assuming newPairs is reduced already.
//   if (oldPairs.length === 1) {
//     if (newVersion === oldPairs[0][0]) return oldPairs as MVRegister
//     const cmp = causalGraph.compareVersions(cg, oldPairs[0][0], newVersion)
//     return cmp === 0 ? [oldPairs[0], [newVersion, newVal]]
//       : cmp < 0 ? oldPairs as MVRegister
//       : [[newVersion, newVal]]
//   }

//   // Use the slow path from mergeRegister above.
//   return mergeRegistersSlow(cg, [[newVersion, newVal], ...oldPairs])
// }

const createToRegValue = (entry: DbEntry, lv: LV, newVal: CreateValue): RegisterValue => {
  if (newVal.type === 'primitive') {
    return newVal
  } else {
    // Create it.
    createCRDT(entry, lv, newVal.crdtKind)
    return {type: "crdt"}
  }
}

function applyRegisterSet(entry: DbEntry, crdtId: LV, mapKey: MapKey | null, oldPairs: Pair<RegisterValue>[], newVersion: LV, newVal: CreateValue): MVRegister {
  const oldVersions = oldPairs.map(([v]) => v)
  // The operation is already included.
  if (oldVersions.includes(newVersion)) return oldPairs as MVRegister

  // Logic adapted from StateSet.
  const result: Pair<RegisterValue>[] = oldPairs.slice()

  causalGraph.findDominators2(entry.cg, [...oldVersions, newVersion], (v, isDominator) => {
    // There's 3 options here: Its in old, its in new, or its in both.
    if (isDominator && v === newVersion) {
      // Its in new only. Add it!
      // console.log('add index', v, crdtId, mapKey, newVersion)
      addIndex(entry.index, {lv: v, key: crdtId, mapKey})

      let newValue = createToRegValue(entry, newVersion, newVal)
      result.push([newVersion, newValue])
    } else if (!isDominator && v !== newVersion) {
      // The item is old, and its been superceded. Remove it!
      // console.log('rm index', v, crdtId, mapKey, oldPairs)
      if (v !== crdtId) removeIndex(entry.index, v)
      const idx = result.findIndex(([v2]) => v2 === v)
      if (idx < 0) throw Error('Invalid state')
      result.splice(idx, 1)
    }
  })

  return result as MVRegister
}

function mergeRegisters(entry: DbEntry, crdtId: LV, mapKey: MapKey | null, oldPairs: Pair<RegisterValue>[], newCreatePairs: Pair<CreateValue>[]): MVRegister {
  const oldVersions = oldPairs.map(([v]) => v)
  for (const [lv] of newCreatePairs) {
    // I could just discard them, but this just shouldn't happen. Its a sign something else has gone wrong.
    if (oldVersions.includes(lv)) throw Error('Duplicate versions in merge')
  }

  // We can't convert the new create pairs into register pairs just yet, because they might not
  // end up in the final document. ... They will, because its an MV register but ... eh. I'll
  // do it below because that feels more correct.
  const newVersions = newCreatePairs.map(([v]) => v)

  // const newPairs = newCreatePairs.map(([lv, val]) => createToRegValue(entry, lv, val))

  // Logic adapted from StateSet.
  const result: Pair<RegisterValue>[] = oldPairs.slice()

  causalGraph.findDominators2(entry.cg, [...oldVersions, ...newVersions], (v, isDominator) => {
    // There's 3 options here: Its in old, its in new, or its in both.
    if (isDominator && !oldVersions.includes(v)) {
      // Its in new only. Add it!
      addIndex(entry.index, {lv: v, key: crdtId, mapKey})

      const idx = newVersions.indexOf(v)
      if (idx < 0) throw Error('Invalid state')
      result.push([v, createToRegValue(entry, v, newCreatePairs[idx][1])])
    } else if (!isDominator && !newVersions.includes(v)) {
      // The item is old, and its been superceded. Remove it!

      // This check is a bit of a hack. The problem it solves is that when a register is created,
      // it gets an index entry for its creation and a value of null. We don't want to remove the
      // index entry for its creation until the CRDT itself its removed / replaced. Hence the check.
      if (v !== crdtId) removeIndex(entry.index, v)
      const idx = result.findIndex(([v2]) => v2 === v)
      if (idx < 0) throw Error('Invalid state')
      result.splice(idx, 1)
    }
  })

  return result as MVRegister
}

export function applyRemoteOp(entry: DbEntry, op: Op): LV {
  const cgEntry = causalGraph.addRaw(entry.cg, op.id, 1, op.parents)
  if (cgEntry == null) {
    // The operation is already known.
    console.warn('Operation already applied', op.id)
    return -1
  }

  const newVersion = cgEntry.version
  const crdtLV = causalGraph.rawToLV2(entry.cg, op.crdtId)

  const crdt = entry.crdts.get(crdtLV)
  if (crdt == null) {
    console.warn('CRDT has been deleted..')
    return newVersion
  }

  // Every register operation creates a new value, and removes 0-n other values.
  switch (op.action.type) {
    case 'registerSet': {
      if (crdt.type !== 'register') throw Error('Invalid operation type for target')
      crdt.value = applyRegisterSet(entry, crdtLV, null, crdt.value, newVersion, op.action.val)
      break
    }

    case 'map': {
      if (crdt.type !== 'map') throw Error('Invalid operation type for target')
      const oldPairs = crdt.registers.get(op.action.key) ?? []
      const newPairs = applyRegisterSet(entry, crdtLV, op.action.key, oldPairs, newVersion, op.action.val)
      crdt.registers.set(op.action.key, newPairs)
      break
    }

    // case 'setInsert': case 'setDelete': { // Sets!
    //   if (crdt.type !== 'set') throw Error('Invalid operation type for target')

    //   // Set operations are comparatively much simpler, because insert
    //   // operations cannot be concurrent and multiple overlapping delete
    //   // operations are ignored.
    //   if (op.action.type == 'setInsert') {
    //     if (op.action.val.type === 'primitive') {
    //       crdt.values.set(newVersion, op.action.val)
    //     } else {
    //       createCRDT(entry, newVersion, op.action.val.crdtKind)
    //       crdt.values.set(newVersion, {type: "crdt", id: newVersion})
    //     }
    //     addIndex(entry.index, {lv: newVersion, key: crdtLV, mapKey: null})
    //   } else {
    //     // Delete!
    //     const target = causalGraph.rawToLV2(entry.cg, op.action.target)
    //     let oldVal = crdt.values.get(target)
    //     if (oldVal != null) {
    //       removeRecursive(entry, oldVal)
    //       crdt.values.delete(target)
    //     }
    //     // This would be fine if we have an operation log. Currently only a grow-only set.
    //     throw Error('Deleting items from a set is currently broken due to index questions')
    //   }

    //   break
    // }

    default: throw Error('Invalid action type')
  }

  // entry.onop?.(entry, op)
  return newVersion
}

export function localMapInsert(entry: DbEntry, agent: string, mapId: LV, key: MapKey, val: CreateValue): [Op, LV] {
  // const crdt = getMap(entry, mapId)

  const crdtId = causalGraph.lvToRaw(entry.cg, mapId)

  // const localParentsLV = (crdt.registers.get(key) ?? []).map(([version]) => version)
  // const localParents = causalGraph.lvToRawList(entry.cg, localParentsLV)
  const op: Op = {
    id: nextVersion(entry, agent),
    crdtId,
    parents: causalGraph.lvToRawList(entry.cg, entry.cg.heads),
    // action: { type: 'map', localParents, key, val }
    action: { type: 'map', key, val }
  }

  // TODO: Could easily inline this - which would mean more code but higher performance.
  const v = applyRemoteOp(entry, op)
  return [op, v]
}

/** Recursively set / insert values into the map to make the map resemble the input */
export function recursivelySetMap(entry: DbEntry, agent: string, mapId: LV, val: Record<string, Primitive>) {
  // The root value already exists. Recursively insert / replace child items.
  const crdt = getMap(entry, mapId)

  for (const k in val) {
    const v = val[k]
    // console.log(k, v)
    if (v === null || typeof v !== 'object') {
      // Set primitive into register.
      // This is a bit inefficient - it re-queries the CRDT and whatnot.
      // console.log('localMapInsert', v)
      localMapInsert(entry, agent, mapId, k, {type: 'primitive', val: v})
    } else {
      if (Array.isArray(v)) throw Error('Arrays not supported') // Could just move this up for now.

      // Or we have a recursive object merge.
      const inner = crdt.registers.get(k)

      // Force the inner item to become a map. Rawr.
      let innerMapId
      const setToMap = () => (
        localMapInsert(entry, agent, mapId, k, {type: "crdt", crdtKind: 'map'})[1]
      )

      if (inner == null) innerMapId = setToMap()
      else {
        // const versions = inner.map(pair => pair[0])
        const [lv, val] = causalGraph.tieBreakPairs(entry.cg, inner)

        if (val.type !== 'crdt') {
          // Its value is a primitive. Set it to a map as well.
          innerMapId = setToMap()
        } else {
          // The inner value is a CRDT. Check what it is.
          const innerInfo = entry.crdts.get(lv)!
          if (innerInfo.type !== 'map') innerMapId = setToMap()
          else innerMapId = lv
        }
      }

      // console.log('recursivelySetMap', innerMapId, v)
      recursivelySetMap(entry, agent, innerMapId, v)
    }
  }
}

export function recursivelySetRoot(entry: DbEntry, agent: string, val: Record<string, Primitive>) {
  // The root value already exists. Recursively insert / replace child items.
  recursivelySetMap(entry, agent, ROOT_LV, val)
}

export function toJS(entry: DbEntry, crdtId: LV = ROOT_LV): any {
  const crdt = entry.crdts.get(crdtId)!
  if (crdt.type === 'register') {
    const [lv, val] = causalGraph.tieBreakPairs(entry.cg, crdt.value)
    return val.type === 'crdt' ? toJS(entry, lv) : val.val
  } else if (crdt.type === 'map') {
    // I'm parsing it into a map in all cases. It'd be nice to support Maps here too.
    const result: Record<string, any> = {}

    for (const [key, inner] of crdt.registers) {
      const [lv, val] = causalGraph.tieBreakPairs(entry.cg, inner)

      const parsed = val.type === 'crdt' ? toJS(entry, lv) : val.val
      result[''+key] = parsed
    }

    return result
  } else {
    throw Error('NYI CRDT type')
  }
}



// export type SnapRegisterValue = {type: 'primitive', val: Primitive}
//   | {type: 'crdt', id: RawVersion}
//   | {type: 'ref', id: RawVersion}
// export type SnapMVRegister = [RawVersion, SnapRegisterValue][]
// export type SnapCRDTInfo = {
//   type: 'map',
//   registers: {[k: string]: SnapMVRegister},
// } | {
//   type: 'set',
//   values: [string, number, SnapRegisterValue][],
// } | {
//   type: 'register',
//   value: SnapMVRegister,
// }

// export interface DBSnapshot {
//   version: RawVersion[],
//   crdts: [string, number, SnapCRDTInfo][]
// }


// *** Serialization ***

// type PSerializedRegisterValue = { type: 'primitive', val: Primitive }
//   | { type: 'crdt' | 'ref', v: RawVersion }

type MVRegisterSet = { offset: LV, val: CreateValue }[]

type CRDTDiff = {
  type: 'register',
  value: MVRegisterSet,
} | {
  type: 'map',
  registers: Map<MapKey, MVRegisterSet>,
  // registers: {k: MapKey, reg: PSerializedMVRegister}[],
// } | {
//   type: 'set',
//   values: [agent: string, seq: number, val: CreateValue][],
}

export interface DbEntryDiff {
  // This doesn't need to be sent with each diff, but eh. Could make it optional,
  // but since I'll use SB's Id type, it actually takes up less bytes to make it a
  // required field.
  appType: string,

  cg: causalGraph.PartialSerializedCGV2,
  // crdts: {agent: string, seq: number, info: PSerializedCRDTInfo}[]

  // In LV order. Using raw versions because many of these CRDT names
  // will predate the cg diff.
  crdtDiffs: {v: RawVersion, diff: CRDTDiff}[]
}

const serializePRegisterValue = (entry: DbEntry, [lv, val]: Pair<RegisterValue>): CreateValue => {
  if (val.type === 'crdt') {
    // if (data.type === 'ref') throw Error('NYI')

    const crdtKind = entry.crdts.get(lv)!.type
    // const rv = causalGraph.lvToRaw(entry.cg, data.id)
    return {type: 'crdt', crdtKind}
  } else {
    return val
  }
}

// const serializePMVRegisterValue = (v: LV, val: RegisterValue, cg: causalGraph.CausalGraph): PSerializedMVRegister[0] => {
//   const rv = causalGraph.lvToRaw(cg, v)
//   return { agent: rv[0], seq: rv[1], val: serializePRegisterValue(val, cg) }
// }

const getOrDef = <K, V>(map: Map<K, V>, key: K, orDefault: () => V): V => {
  let v = map.get(key)
  if (v == null) {
    v = orDefault()
    map.set(key, v)
  }
  return v
}

export function serializePartialSince(entry: DbEntry, v: LV[]): DbEntryDiff {
  if (entry.storesHistory) throw Error('Serializing with history NYI')

  // We'll map it into the desired output format below.
  //
  // And, output format must be in LV order. But maps are guaranteed to maintain their
  // insertion order. Since we visit everything in order of the ranges, this should
  // be ok.
  const crdtDiffMap = new Map<LV, CRDTDiff>()

  const ranges = causalGraph.diff(entry.cg, v, entry.cg.heads).bOnly

  let offset = 0
  for (const [start, end] of ranges) {
    for (const {lv, key, mapKey} of entriesBetween(entry.index, start, end)) {
      // local version (lv) modified the CRDT at (key).

      // If lv represents an entire CRDT itself, that means the CRDT was created. And we know
      // that the remote peer doesn't have this CRDT at all. And its our first time visiting this
      // created child CRDT. We could just create a snapshot of the whole thing, which would be
      // more efficient but eh.

      // Otherwise the CRDT at `key` has been modified - probably with new entries. Find them.
      const info = entry.crdts.get(key)
      if (info == null) throw Error('CRDT named in the index but missing in the data set')

      switch (info.type) {
        case 'register': {
          const diff = getOrDef(crdtDiffMap, key, () => (<CRDTDiff>{type: 'register', value: []}))
          if (diff.type !== 'register') throw Error('Invalid diff type')

          const val = info.value.find(([k]) => k === lv)
          if (val == null) throw Error('Invariant failed: Missing register value, which shows up in the index')
          diff.value.push({
            offset: offset + lv - start,
            val: serializePRegisterValue(entry, val)
          })
          break
        }
        case 'map': {
          const diff = getOrDef(crdtDiffMap, key, () => (<CRDTDiff>{type: 'map', registers: new Map}))
          if (diff.type !== 'map') throw Error('Invalid diff type')
          if (mapKey == null) throw Error('Invalid map entry in index - entry has null mapKey')

          const reg = info.registers.get(mapKey)!
          const val = reg.find(([k]) => k === lv)
          if (val == null) throw Error('Invariant failed: Missing register value, which shows up in the index')

          getOrDef(diff.registers, mapKey, () => ([])).push({
            offset: offset + lv - start,
            val: serializePRegisterValue(entry, val)
          })

          break
        }
        // case 'set': throw Error('NYI')
      }
    }

    offset += end - start
  }

  const crdtDiffEntries = Array.from(crdtDiffMap.entries())
  assertSortedCustom(crdtDiffEntries, e => e[0])
  return {
    appType: entry.appType,
    cg: causalGraph.serializeFromVersion(entry.cg, v),
    // Gross. Should be correct though.
    crdtDiffs: crdtDiffEntries.map(([lv, diff]) => ({
      v: causalGraph.lvToRaw(entry.cg, lv),
      diff
    })),
  }
}

export function mergePartialDiff(entry: DbEntry, delta: DbEntryDiff): LVRange {
  const range = causalGraph.mergePartialVersions(entry.cg, delta.cg)
  const start = range[0]
  const cgDeltaEnh = causalGraph.enhanceCGDiff(delta.cg)

  for (const {v: rv, diff} of delta.crdtDiffs) {
    const crdtLv = causalGraph.rawToLV2(entry.cg, rv)

    const crdt = entry.crdts.get(crdtLv)
    if (crdt == null) throw Error('Diff modifies missing CRDT')

    switch (diff.type) {
      case 'register': {
        if (crdt.type !== 'register') throw Error('Invalid CRDT type')
        const newValues = diff.value.map(({offset, val}): Pair<CreateValue> => {
          const lv = causalGraph.diffOffsetToMaybeLV(entry.cg, start, cgDeltaEnh, offset)
          return [lv, val]
        }).filter(([lv]) => lv >= 0) // Filter out updates we know about.

        crdt.value = mergeRegisters(entry, crdtLv, null, crdt.value, newValues)
        break
      }
      case 'map': {
        if (crdt.type !== 'map') throw Error('Invalid CRDT type')
        for (const [key, regDiff] of diff.registers) {
          // TODO: Naughty copy+pasta! Bad! Fix!
          const newValues = regDiff.map(({offset, val}): Pair<CreateValue> => {
            const lv = causalGraph.diffOffsetToMaybeLV(entry.cg, start, cgDeltaEnh, offset)
            return [lv, val]
          }).filter(([lv]) => lv >= 0) // Filter out updates we know about.

          const oldPairs = crdt.registers.get(key) ?? []
          const newPairs = mergeRegisters(entry, crdtLv, key, oldPairs, newValues)
          crdt.registers.set(key, newPairs)
        }

        break
      }
    }
  }

  // for (const {vOffset, key: keyRaw, val} of delta.ops) {
  //   const lv = causalGraph.diffOffsetToMaybeLV(crdt.cg, start, cgDeltaEnh, vOffset)
  //   if (lv < 0) continue // We already have this delta.

  //   const key = causalGraph.rawToLV2(crdt.cg, keyRaw)

  //   if (newPairs[key] == null) newPairs[key] = [[lv, val]]
  //   else newPairs[key].push([lv, val])
  // }

  return range
}


// ;(() => {

//   const console = new Console({
//     stdout: process.stdout,
//     stderr: process.stderr,
//     inspectOptions: {depth: null}
//   })

//   const entry = createEntry()
//   localMapInsert(entry, ['seph', 0], ROOT_LV, 'cool', {type: 'primitive', val: true})
//   // localMapInsert(entry, ['seph', 1], ROOT_LV, 'cool', {type: 'primitive', val: false})
//   // localMapInsert(entry, ['seph', 1], ROOT_LV, 'beans', {type: 'primitive', val: 123})
//   const [_op, k] = localMapInsert(entry, ['seph', 1], ROOT_LV, 'beans', {type: 'crdt', crdtKind: 'register'})
//   // localMapInsert(entry, ['seph', 2], k, 'beans', {type: 'crdt', crdtKind: 'register'})


//   let diff = serializePartialSince(entry, [])
//   const e2 = createEntry()
//   mergePartialDiff(e2, diff)

//   applyRemoteOp(entry, {
//     action: {
//       type: 'registerSet',
//       val: {type: 'primitive', val: 'cool'},
//     },
//     crdtId: causalGraph.lvToRaw(entry.cg, k),
//     id: ['seph', 2],
//     parents: [['seph', 1]],
//   })

//   diff = serializePartialSince(entry, [1])
//   console.log(diff)
//   // let diff =
//   mergePartialDiff(e2, diff)


//   console.log(entry)
//   // console.log(diff)

//   console.log(e2)

// })()

// ;(() => {

//   const console = new Console({
//     stdout: process.stdout,
//     stderr: process.stderr,
//     inspectOptions: {depth: null}
//   })

//   const entry = createEntry()

//   const agent: AgentVersion = ['seph', 0]
//   recursivelySetMap(entry, agent, ROOT_LV, {
//     cool: true,
//     yo: {
//       x: 5, y: 7
//     }
//   })

//   console.log(entry)
// })()