import * as causalGraph from "./causal-graph.js";
import { Op, AtLeast1, LV, OpSet, Primitive, RawOperation, RawVersion, CRDTInfo, SyncConfig } from "./types.js";
import { AgentVersion, createAgent, min2, nextVersion, rateLimit } from "./utils.js";
import * as sb from 'schemaboi'
import {localDbSchema} from './schema.js'
import * as fs from 'node:fs'
import * as ss from "./stateset.js"

// export interface DbOld {
//   cg: causalGraph.CausalGraph,

//   /**
//    * Checked out version.
//    *
//    * Note there's a similar variable called cg.heads which names the 'global'
//    * heads - which is what we sync. But we could be looking at an earlier
//    * version.
//    */
//   branch: LV[],

//   // val: [LV, Primitive][],
//   ops: Map<number, Op>, // Local version to op. Could trim?

//   agent: AgentVersion,

//   // events: EventEmitter,
//   listeners: Set<(from: 'local' | 'remote') => void>,
// }

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
   * Checked out version.
   *
   * Note there's a similar variable called cg.heads which names the 'global'
   * heads - which is what we sync. But we could be looking at an earlier
   * version on this peer.
   */
  branch: LV[],

  // Ops.
}

export interface Db {
  inbox: ss.StateSet, // Includes its own causal graph.
  entries: Map<LV, DbEntry>,

  agent: AgentVersion,

  syncConfig: SyncConfig,

  // TODO: Separate listeners on the index from listeners on a db entry.
  listeners: Set<(from: 'local' | 'remote') => void>,
}


export const createDb = (): Db => ({
  inbox: ss.create(),
  entries: new Map(),
  agent: createAgent(),
  syncConfig: 'all',
  listeners: new Set(),
})

// const SAVE_FILE = process.env['DB_FILE'] || 'db.scb'

const saveNow = (filename: string, schema: sb.Schema, db: Db) => {
  const data = sb.write(schema, db)
  console.log(`saving ${data.byteLength} bytes`)

  // console.log('data', data)
  fs.writeFileSync(filename, data)
  console.log('Db saved to', filename)
}

const load = (filename: string): [sb.Schema, Db] => {
  try {
    const rawData = fs.readFileSync(filename)
    const [mergedSchema, db] = sb.read(localDbSchema, rawData)
    return [mergedSchema, db as Db]
  } catch (e: any) {
    if (e.code == 'ENOENT') {
      console.warn('Warning: Existing database does not exist. Creating a new one!')
      const db = createDb()
      saveNow(filename, localDbSchema, db)
      return [localDbSchema, db]
    } else {
      console.error('Could not load previous database data')
      throw e
    }
  }
}

export function emitChangeEvent(db: Db, from: 'local' | 'remote') {
  for (const listener of db.listeners) {
    listener(from)
  }
}

export function createOrLoadDb(filename: string = process.env['DB_FILE'] ?? 'db.scb'): Db {
  const [schema, db] = load(filename)

  const save = rateLimit(1000, () => saveNow(filename, schema, db))
  db.listeners.add(save)

  process.on('exit', () => {
    // console.log('exit')
    save.doItNow()
  })

  console.log('agent', db.agent)

  return db
}

// Global singleton database for this process.
// export const [storageSchema, db] = load()


process.on('SIGTERM', () => {
  // save()
  process.exit()
})
process.on('SIGINT', () => {
  // save()
  process.exit()
})

process.on('uncaughtException', e => {
  console.error(e)
  process.exit(1)
})

process.on('unhandledRejection', e => {
  console.error(e)
  process.exit(1)
})







// export const getAllVals = (db: Db): Primitive[] => {
//   // If the branch is empty, we'll return an empty list.
//   return db.branch.map(lv => db.ops.get(lv)!.val)
// }


// export const getVal = (db: Db): Primitive => {
//   // Empty database / branch.
//   if (db.branch.length === 0) return null

//   let v = causalGraph.tieBreakVersions(db.cg, db.branch as AtLeast1<LV>)
//   let op = db.ops.get(v) // The branch version should always be pinned.
//   if (op == null) throw Error('Missing operation in DB')

//   return op.val
// }

// export const set = (db: Db, val: Primitive): LV => {
//   let [agentId, seq] = nextVersion(db.agent)
//   let lv = causalGraph.assignLocal(db.cg, agentId, seq, db.branch)
//   db.ops.set(lv, {type: 'set', val})
//   db.branch = [lv]
//   emitChangeEvent(db, 'local')
//   return lv
// }

// export const getOpsInDiff = (db: Db, diff: causalGraph.PartialSerializedCGV2): OpSet => {
//   const opsToSend: OpSet = new Map
//   let diffSeq = 0
//   for (let {agent, seq, len} of diff) {
//     do {
//       // Take as many as we can (max len) from agent/seq.
//       // let [lv, spanLen] = cg.rawToLVSpan(from.cg, agent, seq)
//       // const lenHere = min2(len, spanLen)

//       let [lvStart, lvEnd] = causalGraph.rawToLVSpan(db.cg, agent, seq)
//       lvEnd = min2(lvEnd, lvStart + len)
//       const processedHere = lvEnd - lvStart

//       for (let i = 0; i < processedHere; i++) {
//         let op = db.ops.get(lvStart + i)
//         if (op != null) {
//           opsToSend.set(diffSeq + i, op)
//         }
//       }

//       len -= processedHere
//       diffSeq += processedHere
//     } while (len > 0)
//   }
//   return opsToSend
// }

// /** NOTE: This method does not notify listeners! */
// export const mergeDelta = (db: Db, cgDiff: causalGraph.PartialSerializedCGV2, opset: OpSet) => {
//   let diffSeq = 0

//   for (const {agent, seq, len, parents} of cgDiff) {
//     // Note the entry returned here could be pruned from the start - and only contain the tail
//     // end of the CG entries.
//     let entry = causalGraph.addRaw(db.cg, [agent, seq], len, parents)

//     // If entry is null, we've already recieved & merged these versions.
//     // We could merge any change we have pruned locally if we want - but eh worry about that later.
//     if (entry != null) {
//       const diffBase = diffSeq + (entry.seq - seq) // Ignore ops we already have.
//       for (let i = 0; i < (entry.vEnd - entry.version); i++) {
//         let op = opset.get(diffBase + i)
//         if (op != null) db.ops.set(entry.version + i, op)
//       }
//       // And advance into's branch by the new entry.
//       db.branch = causalGraph.advanceFrontier(db.branch, entry.vEnd - 1, entry.parents)
//     }
//     diffSeq += len
//   }

//   // setImmediate(() => {
//   //   db.events.emit('change', 'remote')
//   // })
// }
