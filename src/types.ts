import type * as causalGraph from "causal-graph"
import type { DbEntryDiff } from "./db-entry.js"
import type { LMIndex } from "./last-modified-index.js"

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


export type CRDTRegisterValue = { type: 'register', value: MVRegister }
export type CRDTMapValue = { type: 'map', registers: Map<MapKey, MVRegister> }
/** When there's no history, sets have deleted values removed perminantly. */
export type CRDTSetValue = { type: 'set', values: Map<LV, RegisterValue> }

// export type CRDTInfo = CRDTMapInfo | CRDTSetInfo | CRDTRegisterInfo
export type CRDTValue = CRDTRegisterValue | CRDTMapValue


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

export type DocName = string // Might replace this with a UUID at some point.

// Network messages
export type NetMsg = {
  type: 'Hello',
  /**
   * The currently known version for every document.
   *
   * I'd like to optimize this - and find a way to avoid sending the VersionSummary
   * for documents which haven't changed in awhile.
   *
   * The right way to solve that is with something like a tree of hashes sorted by
   * date, and then we can optimistically only send a subset of those hashes on
   * connect. That would let us trade off bandwidth & RTT against each other.
   *
   * This current approach uses a linear amount of network traffic & CPU based on the
   * total number of stored documents. Thats fine for now.
   *
   * This network protocol approach also sends the set of all document versions
   * to all peers, including peers which only need / want to know about 1 document.
   * Changing that would add 1 more RTT, but reduce the size of the first packets.
   * ... Something to think about later.
   */
  versions: Map<DocName, VersionSummary>,
  // inboxVersion: VersionSummary,
  sync: SyncConfig,
} | {
  type: 'DocDeltas',
  // delta: SSDelta,
  deltas: Map<DocName, DbEntryDiff>,

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
  crdts: Map<LV, CRDTValue>,
  cg: causalGraph.CausalGraph,

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

  // We're going to use the same agent ID across all documents to reduce network
  // traffic. But each document will have its own sequence of (agent, ID) pairs.
  nextSeq: number,

  // This is the application schema type of the DbEntry. Think of this like a mime-type
  // for documents. Eg, "post".
  appType: string,
}

export interface Db {
  // inbox: ss.StateSet // Includes its own causal graph.

  /**
   * The set of DB entries, mapped by the entry's ID.
   */
  entries: Map<DocName, DbEntry>

  // The agent and syncConfig should probably go in the RuntimeContext,
  // but we also need to persist & restore configuration like this to disk.
  // For now I'm putting them here, but I might refactor this to move them
  // into a config object or something. TODO.
  agent: string,

  syncConfig: SyncConfig,
}

export interface InboxFields {
  type: string,
  // Usually just 1 version, but might be multiple versions if the document
  // has been concurrently edited.
  //
  // Also we might not have the version named by heads.
  heads: RawVersion[],
}

export type DbChangeListener = (
  from: 'local' | 'remote',
  changed: Set<DocName>,
  // changed: Set<[docName: DocName, oldHeads: LV[]]>,
  deltas: Map<DocName, DbEntryDiff>
) => void


export type SimpleEventEmitter<F extends (...args: any[]) => void> = Set<F>

export interface RuntimeContext {
  db: Db,

  globalKnownVersions: Map<DocName, LV[]>

  listeners: SimpleEventEmitter<DbChangeListener>,
}

