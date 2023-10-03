// import { type } from "os"

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

export type Action =
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
  action: Action,
}

/** Helper type for a list with at least 1 entry in it. */
export type AtLeast1<T> = [T, ...T[]]

// export type VersionSummary = [string, [number, number][]][]
export interface VersionSummary {[agent: string]: [number, number][]}
// export type RawHeads = RawVersion[]