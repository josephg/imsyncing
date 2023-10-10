// import { type } from "os"

// import { PartialSerializedCGV2 } from "./causal-graph.js"
import * as causalGraph from "./causal-graph.js"
import { LMIndex } from "./last-modified-index.js"
import * as ss from "./stateset.js"
import {SSDelta} from './stateset.js'
import { AgentVersion } from "./utils.js"

export type RawVersion = [agent: string, seq: number]

export const ROOT: RawVersion = ['ROOT', 0]

/** Local version */
export type LV = number

/** Local version range. Range is [start, end). */
export type LVRange = [start: number, end: number]

export const ROOT_LV: LV = -1

export type Primitive = null
  | boolean
  | string
  | number
  | Primitive[]
  | {[k: string]: Primitive}

export type MapKey = boolean | string | number

// /** Helper type for a list with at least 1 entry in it. */
// export type AtLeast1<T> = [T, ...T[]]

// export type VersionSummary = [string, [number, number][]][]
export interface VersionSummary {[agent: string]: [number, number][]}
// export type RawHeads = RawVersion[]

export type Pair<T=Primitive> = [LV, T]


// These are sequence numbers in the order of the CG delta being sent.
// 0 = first sent CG change, and so on.
// These could be compacted better using RLE. They'll often just be a filled set of ordinals (1,2,3,4,...).
// export type OpSet = Map<number, Op>


export type RegisterValue = {type: 'primitive', val: Primitive}
  | {type: 'crdt'} // A unique (owned) CRDT.
  // | {type: 'ref', id: LV} // A reference to another CRDT in this entry. May be null.

/** This register stores a list of its current [LV, value] pairs.
 *
 * It has no history. We need to do something else to add history.
 */
export type MVRegister = Pair<RegisterValue>[]
// export type MVRegister = AtLeast1<Pair<RegisterValue>>


export type CRDTMapInfo = { type: 'map', registers: Map<MapKey, MVRegister> }
/** When there's no history, sets have deleted values removed perminantly. */
export type CRDTSetInfo = { type: 'set', values: Map<LV, RegisterValue> }
export type CRDTRegisterInfo = { type: 'register', value: MVRegister }

// export type CRDTInfo = CRDTMapInfo | CRDTSetInfo | CRDTRegisterInfo
export type CRDTInfo = CRDTMapInfo | CRDTRegisterInfo


// *** Operations. This is for ops on a DbEntry. ***
export type CreateValue = {type: 'primitive', val: Primitive}
  // | {type: 'ref', target: LV}
  | {type: 'crdt', crdtKind: 'map' | 'set' | 'register'}

export type Action =
{ type: 'map', key: MapKey, val: CreateValue }
| { type: 'registerSet', val: CreateValue }
| { type: 'setInsert', val: CreateValue }
| { type: 'setDelete', target: RawVersion }
// export type Action =
// { type: 'map', key: CRDTMapKey, localParents: RawVersion[], val: CreateValue }
// | { type: 'registerSet', localParents: RawVersion[], val: CreateValue }
// | { type: 'setInsert', val: CreateValue }
// | { type: 'setDelete', target: RawVersion }

export interface Op {
  /** Agent / seq of this operation */
  id: RawVersion,
  /** Parents of this op in the DbEntry's causal graph */
  parents: RawVersion[],
  /** CRDT that is modified by this operation */
  crdtId: RawVersion,
  /** What the action does. Action kind must match the crdtId's kind. */
  action: Action,
}


// export type OpSet = {
//   // These are sequence numbers in the order of the CG delta being sent.
//   // 0 = first sent CG change, and so on.
//   // These could be compacted better using RLE. They'll often just be ordinals (1,2,3,4,...).
//   diffSeq: number,
//   op: Op
// }[]

export type SyncConfig = 'all' | 'none' // .. or only one value, or one type, ...

// Network messages
export type NetMsg = {
  type: 'Hello',
  inboxVersion: VersionSummary,
  sync: SyncConfig,
} | {
  type: 'InboxDelta',
  delta: SSDelta,
// } | {
  // type: 'Delta',
  // cg: PartialSerializedCGV2
  // ops: OpSet
// } | {
//   type: 'idx delta',
//   delta: ss.RemoteStateDelta
// } | {
//   // Get the changes to a document since the named version.
//   type: 'get doc',
//   k: RawVersion,
//   since: VersionSummary, // OPT: Could probably just send the version here most of the time.
// } | {
//   type: 'doc delta',
//   k: RawVersion,
//   delta: dt.PSerializedFancyDBv1
// } | {
//   // Unused!
//   type: 'ack',
//   v: RawVersion[]
}

/** A single entry in the database.
 *
 * Each db entry contains a tree of CRDT objects that can be modified in
 * atomic transactions. The entire entry is synced together - you can't sync
 * a partial view of a DbEntry.
 */

export interface DbEntry {
  crdts: Map<LV, CRDTInfo>,
  cg: causalGraph.CausalGraph,

  /**
   * The index is currently just showing recently modified CRDTs on the whole.
   * This means if you have a big map with 1 frequently modified key, we'll be
   * scanning the map a lot to find what is getting changed. The alternative is to
   * make a bigger index which stores the keys as well. Not sure whats better here!
   */
  index: LMIndex<{key: LV, mapKey: MapKey | null}>,

  /** Entries can either store their history or not. This is for now a global
   * (per doc) setting for the entire network. Ie, peers can't individually decide
   * not to store history for a specific document. (Since that would make sync
   * more difficult).
   *
   * There's a few differences between items with and without history:
   *
   * - With history, we can browse and checkout arbitrary branches in time.
   *   Otherwise any checked out branch is always the latest version of the
   *   db entry.
   * - With no history, we store & send less data
   *
   * Note that some data types (well, text & sequences) always store their history.
   * But if a text document is in an entry which doesn't store history, and the
   * text document gets deleted, the text document's history is also removed from the
   * database.
   */
  storesHistory: boolean

  /**
   * Checked out version.
   *
   * Note there's a similar variable called cg.heads which names the 'global'
   * heads - which is what we sync. But we could be looking at an earlier
   * version on this peer.
   */
  branch: LV[]

  // TODO: Should we create a local user agent here?
}

export interface Db {
  inbox: ss.StateSet // Includes its own causal graph.
  entries: Map<LV, DbEntry>

  agent: AgentVersion

  syncConfig: SyncConfig

  // TODO: Separate listeners on the index from listeners on a db entry.
  listeners: Set<(from: 'local' | 'remote') => void>
}

