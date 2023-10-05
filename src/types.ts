// import { type } from "os"

import { PartialSerializedCGV2 } from "./causal-graph.js"

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

// export type CreateValue = {type: 'primitive', val: Primitive}
//   | {type: 'crdt', crdtKind: 'map' | 'set' | 'register'}

export type Op =
  { type: 'set', val: Primitive }
// export type Action =
// { type: 'map', key: string, localParents: RawVersion[], val: CreateValue }
// | { type: 'registerSet', localParents: RawVersion[], val: CreateValue }
// | { type: 'setInsert', val: CreateValue }
// | { type: 'setDelete', target: RawVersion }

export interface RawOperation {
  id: RawVersion,
  parents: RawVersion[],
  // globalParents: RawVersion[],
  // crdtId: RawVersion,
  op: Op,
}

/** Helper type for a list with at least 1 entry in it. */
export type AtLeast1<T> = [T, ...T[]]

// export type VersionSummary = [string, [number, number][]][]
export interface VersionSummary {[agent: string]: [number, number][]}
// export type RawHeads = RawVersion[]



// These are sequence numbers in the order of the CG delta being sent.
// 0 = first sent CG change, and so on.
// These could be compacted better using RLE. They'll often just be a filled set of ordinals (1,2,3,4,...).
export type OpSet = Map<number, Op>

// export type OpSet = {
//   // These are sequence numbers in the order of the CG delta being sent.
//   // 0 = first sent CG change, and so on.
//   // These could be compacted better using RLE. They'll often just be ordinals (1,2,3,4,...).
//   diffSeq: number,
//   op: Op
// }[]

// Network messages
export type NetMsg = {
  type: 'Hello',
  versionSummary: VersionSummary
} | {
  type: 'Delta',
  cg: PartialSerializedCGV2
  ops: OpSet
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
