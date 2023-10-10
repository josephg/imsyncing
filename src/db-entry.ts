// This file contains methods & tools to interact with database entries.
// This code was stolen & modified from the DbEntry code in replca's JS implementation.

import { AtLeast1, CRDTInfo, CRDTMapInfo, CreateValue, DbEntry, LV, MVRegister, Op, Pair, Primitive, ROOT_LV, RawVersion, RegisterValue } from "./types.js"
import * as causalGraph from './causal-graph.js'
import { AgentVersion, errExpr, nextVersion } from "./utils.js"
import { addIndex, entriesBetween, removeIndex } from "./last-modified-index.js"

const createEntry = (storesHistory: boolean = false): DbEntry => {
  if (storesHistory) throw Error('Storing history is NYI.')

  return {
    crdts: new Map<LV, CRDTInfo>([
      // CRDTs start with a root CRDT object entry.
      [ ROOT_LV, { type: 'map', registers: new Map() } ]
    ]),
    cg: causalGraph.create(),
    index: [],
    storesHistory,
    branch: [],
  }
}

function removeRecursive(entry: DbEntry, value: RegisterValue) {
  if (value.type !== 'crdt') return

  const crdt = entry.crdts.get(value.id)
  if (crdt == null) return

  switch (crdt.type) {
    case 'map':
      for (const [k, reg] of crdt.registers) {
        for (const [version, value] of reg) {
          removeRecursive(entry, value)
        }
      }
      break
    case 'register':
      for (const [version, value] of crdt.value) {
        removeRecursive(entry, value)
      }
      break
    case 'set':
      for (const [id, value] of crdt.values) {
        removeRecursive(entry, value)
      }
      break
    // case 'stateset':
    //   throw Error('Cannot remove from a stateset')
      
    default: throw Error('Unknown CRDT type!?')
  }

  entry.crdts.delete(value.id)
}

function createCRDT(entry: DbEntry, id: LV, type: 'map' | 'set' | 'register' | 'stateset') {
  if (entry.crdts.has(id)) {
    throw Error('CRDT already exists !?')
  }

  const crdtInfo: CRDTInfo = type === 'map' ? {
    type: "map",
    registers: new Map,
  } : type === 'register' ? {
    type: 'register',
    // Registers default to NULL when created.
    value: [[id, {type: 'primitive', val: null}]],
  } : type === 'set' ? {
    type: 'set',
    values: new Map,
  // } : type === 'stateset' ? {
  //   type: 'stateset',
  //   values: new Map,
  } : errExpr('Invalid CRDT type')

  entry.crdts.set(id, crdtInfo)

  addIndex(entry.index, id, id)
}

const getMap = (entry: DbEntry, mapId: LV): CRDTMapInfo => {
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

function applyRegisterSet(entry: DbEntry, crdtId: LV, oldPairs: Pair<RegisterValue>[], newVersion: LV, newVal: CreateValue): MVRegister {
  const oldVersions = oldPairs.map(([v]) => v)
  // The operation is already included.
  if (oldVersions.includes(newVersion)) return oldPairs as MVRegister

  let newValue: RegisterValue
  if (newVal.type === 'primitive') {
    newValue = newVal
  } else {
    // Create it.
    createCRDT(entry, newVersion, newVal.crdtKind)
    newValue = {type: "crdt", id: newVersion}
  }

  // Logic adapted from StateSet.
  const result: Pair<RegisterValue>[] = oldPairs.slice()

  causalGraph.findDominators2(entry.cg, [...oldVersions, newVersion], (v, isDominator) => {
    // There's 3 options here: Its in old, its in new, or its in both.
    if (isDominator && v === newVersion) {
      // Its in new only. Add it!
      addIndex(entry.index, v, crdtId)

      result.push([newVersion, newValue])
    } else if (!isDominator && v !== newVersion) {
      // The item is old, and its been superceded. Remove it!
      removeIndex(entry.index, v)
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
      crdt.value = applyRegisterSet(entry, crdtLV, crdt.value, newVersion, op.action.val)
      break
    }

    case 'map': {
      if (crdt.type !== 'map') throw Error('Invalid operation type for target')
      const oldPairs = crdt.registers.get(op.action.key) ?? []
      const newPairs = applyRegisterSet(entry, crdtLV, oldPairs, newVersion, op.action.val)
      crdt.registers.set(op.action.key, newPairs)
      break
    }

    case 'setInsert': case 'setDelete': { // Sets!
      if (crdt.type !== 'set') throw Error('Invalid operation type for target')

      // Set operations are comparatively much simpler, because insert
      // operations cannot be concurrent and multiple overlapping delete
      // operations are ignored.
      if (op.action.type == 'setInsert') {
        if (op.action.val.type === 'primitive') {
          crdt.values.set(newVersion, op.action.val)
        } else {
          createCRDT(entry, newVersion, op.action.val.crdtKind)
          crdt.values.set(newVersion, {type: "crdt", id: newVersion})
        }
        addIndex(entry.index, newVersion, crdtLV)
      } else {
        // Delete!
        const target = causalGraph.rawToLV2(entry.cg, op.action.target)
        let oldVal = crdt.values.get(target)
        if (oldVal != null) {
          removeRecursive(entry, oldVal)
          crdt.values.delete(target)
        }
        // This would be fine if we have an operation log. Currently only a grow-only set.
        throw Error('Deleting items from a set is currently broken due to index questions')
      }

      break
    }

    default: throw Error('Invalid action type')
  }

  // entry.onop?.(entry, op)
  return newVersion
}

export function localMapInsert(entry: DbEntry, id: RawVersion, mapId: LV, key: string, val: CreateValue): [Op, LV] {
  // const crdt = getMap(entry, mapId)

  const crdtId = causalGraph.lvToRaw(entry.cg, mapId)

  // const localParentsLV = (crdt.registers.get(key) ?? []).map(([version]) => version)
  // const localParents = causalGraph.lvToRawList(entry.cg, localParentsLV)
  const op: Op = {
    id,
    crdtId,
    parents: causalGraph.lvToRawList(entry.cg, entry.cg.heads),
    // action: { type: 'map', localParents, key, val }
    action: { type: 'map', key, val }
  }

  // TODO: Could easily inline this - which would mean more code but higher performance.
  const v = applyRemoteOp(entry, op)
  return [op, v]
}

// /** Recursively set / insert values into the map to make the map resemble the input */
// export function recursivelySetMap(entry: DbEntry, agent: AgentVersion, mapId: LV, val: Record<string, Primitive>) {
//   // The root value already exists. Recursively insert / replace child items.
//   const crdt = getMap(entry, mapId)

//   for (const k in val) {
//     const v = val[k]
//     // console.log(k, v)
//     if (v === null || typeof v !== 'object') {
//       // Set primitive into register.
//       // This is a bit inefficient - it re-queries the CRDT and whatnot.
//       // console.log('localMapInsert', v)
//       localMapInsert(entry, nextVersion(agent), mapId, k, {type: 'primitive', val: v})
//     } else {
//       if (Array.isArray(v)) throw Error('Arrays not supported') // Could just move this up for now.

//       // Or we have a recursive object merge.
//       const inner = crdt.registers.get(k)

//       // Force the inner item to become a map. Rawr.
//       let innerMapId
//       const setToMap = () => (
//         localMapInsert(entry, nextVersion(agent), mapId, k, {type: "crdt", crdtKind: 'map'})[1]
//       )

//       if (inner == null) innerMapId = setToMap()
//       else {
//         const versions = inner.map(pair => pair[0])
//         const activeVersion = causalGraph.tieBreakVersions(entry.cg, versions as AtLeast1<LV>)

//         if (activePair.type !== 'crdt') {
//           innerMapId = setToMap()
//         } else {
//           const innerId = activePair.id
//           const innerInfo = entry.crdts.get(innerId)!
//           if (innerInfo.type !== 'map') innerMapId = setToMap()
//           else innerMapId = innerId
//         }
//       }

//       // console.log('recursivelySetMap', innerMapId, v)
//       recursivelySetMap(entry, agent, innerMapId, v)
//     }
//   }
// }

// export function recursivelySetRoot(entry: DbEntry, agent: AgentVersion, val: Record<string, Primitive>) {
//   // The root value already exists. Recursively insert / replace child items.
//   recursivelySetMap(db, agent, ROOT_LV, val)
// }



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

type PSerializedRegisterValue = { type: 'primitive', val: Primitive }
  | { type: 'crdt' | 'ref', v: RawVersion }

type PSerializedMVRegister = { offset: LV, val: PSerializedRegisterValue }[]

type PSerializedCRDTInfo = {
//   type: 'map',
//   registers: [k: string, reg: PSerializedMVRegister][],
// } | {
//   type: 'set',
//   values: [agent: string, seq: number, val: PSerializedRegisterValue][],
// } | {
  type: 'register',
  value: PSerializedMVRegister,
}

export interface PSerializedFancyDBv1 {
  cg: causalGraph.PartialSerializedCGV2,
  // crdts: {agent: string, seq: number, info: PSerializedCRDTInfo}[]
  crdts: Map<RawVersion, PSerializedCRDTInfo>
}

const serializePRegisterValue = (data: RegisterValue, cg: causalGraph.CausalGraph): PSerializedRegisterValue => {
  if (data.type === 'crdt' || data.type === 'ref') {
    const rv = causalGraph.lvToRaw(cg, data.id)
    return {type: data.type, v: rv}
  } else {
    return {type: 'primitive', val: data.val}
  }
}

// const serializePMVRegisterValue = (v: LV, val: RegisterValue, cg: causalGraph.CausalGraph): PSerializedMVRegister[0] => {
//   const rv = causalGraph.lvToRaw(cg, v)
//   return { agent: rv[0], seq: rv[1], val: serializePRegisterValue(val, cg) }
// }

export function serializePartialSince(entry: DbEntry, v: LV[]): PSerializedFancyDBv1 {
  if (entry.storesHistory) throw Error('Serializing with history NYI')

  // We'll map it into the desired output format below.
  const crdtDiffs = new Map<LV, PSerializedCRDTInfo>()

  const ranges = causalGraph.diff(entry.cg, v, entry.cg.heads).bOnly

  let offset = 0
  for (const [start, end] of ranges) {
    for (const {lv, key} of entriesBetween(entry.index, start, end)) {
      // local version (lv) modified the CRDT at (key).

      // First, if lv represents an entire CRDT itself, that means the CRDT was created. And we know
      // that the remote peer doesn't have this CRDT at all. And its our first time visiting this
      // created child CRDT. Just add a snapshot of the whole thing.
      const missingCRDT = entry.crdts.get(lv)
      if (missingCRDT != null) {
        // Send this entire CRDT.
        throw Error('TODO')
      }

      // Otherwise the CRDT at `key` has been modified - probably with new entries. Find them.
      const info = entry.crdts.get(key)
      if (info == null) throw Error('CRDT named in the index but missing in the data set')

      switch (info.type) {
        case 'register': {
          let diff = crdtDiffs.get(key)
          if (diff == null) {
            diff = {type: 'register', value: []}
            crdtDiffs.set(key, diff)
          }
          const val = info.value.find(([k]) => k === lv)
          if (val == null) throw Error('Invariant failed: Missing register value, which shows up in the index')
          diff.value.push({
            offset: offset + lv - start,
            val: serializePRegisterValue(val[1], entry.cg)
          })
          break
        }
        case 'map': {
          
          break
        }
        case 'set': throw Error('NYI')
      }
    }

    offset += end - start
  }




  // const shouldIncludeV = (v: LV): boolean => (
  //   // This could be implemented using a binary search, but given the sizes involved this is fine.
  //   ranges.find(([start, end]) => (start <= v) && (v < end)) != null
  // )

  // const encodeMVRegister = (reg: MVRegister, includeAll: boolean): null | PSerializedMVRegister => {
  //   // I'll do this in an imperative way because its called so much.
  //   let result: null | PSerializedMVRegister = null
  //   for (const [v, val] of reg) {
  //     if (includeAll || shouldIncludeV(v)) {
  //       result ??= []
  //       result.push(serializePMVRegisterValue(v, val, entry.cg))
  //     }
  //   }
  //   return result
  // }

  // // So this is SLOOOW for big documents. A better implementation would store
  // // operations and do a whole thing sending partial operation logs.
  // for (const [id, info] of entry.crdts.entries()) {
  //   // If the CRDT was created recently, just include all of it.
  //   const includeAll = shouldIncludeV(id)

  //   let infoOut: PSerializedCRDTInfo | null = null
  //   switch (info.type) {
  //     case 'map': {
  //       let result: null | [k: string, reg: PSerializedMVRegister][] = null
  //       for (let k in info.registers) {
  //         const v = info.registers[k]

  //         const valHere = encodeMVRegister(v, includeAll)
  //         // console.log('valHere', valHere)
  //         if (valHere != null) {
  //           result ??= []
  //           result.push([k, valHere])
  //         }
  //       }
  //       if (result != null) infoOut = ['map', result]
  //       break
  //     }
  //     case 'register': {
  //       const result = encodeMVRegister(info.value, includeAll)
  //       if (result != null) infoOut = ['register', result]
  //       // if (result != null) {
  //         // const rv = causalGraph.lvToRaw(db.cg, id)
  //         // crdts.push([rv[0], rv[1], ['register', result]])
  //       // }

  //       break
  //     }

  //     case 'set': {
  //       // TODO: Weird - this looks almost identical to the register code!
  //       let result: null | [agent: string, seq: number, val: PSerializedRegisterValue][] = null
  //       for (const [k, val] of info.values.entries()) {
  //         if (includeAll || shouldIncludeV(k)) {
  //           result ??= []
  //           result.push(serializePMVRegisterValue(k, val, entry.cg))
  //         }
  //       }
  //       if (result != null) infoOut = ['set', result]
  //       // if (result != null) {
  //       //   const rv = causalGraph.lvToRaw(db.cg, id)
  //       //   crdts.push([rv[0], rv[1], ['set', result]])
  //       // }
  //       break
  //     }
  //   }

  //   if (infoOut != null) {
  //     const rv = causalGraph.lvToRaw(entry.cg, id)
  //     crdts.push([rv[0], rv[1], infoOut])
  //   }
  // }

  return {
    cg: causalGraph.serializeFromVersion(entry.cg, v),
    // Gross.
    crdts: new Map(Array.from(crdtDiffs.entries()).map(([lv, diff]) => ([causalGraph.lvToRaw(entry.cg, lv), diff])))
  }
}
