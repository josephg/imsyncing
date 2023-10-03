import * as cg from "./causal-graph.js";
import { Action, AtLeast1, LV, Primitive, RawOperation, RawVersion } from "./types.js";
import { AgentVersion, createAgent, min2, nextVersion, rateLimit } from "./utils.js";
import * as sb from 'schemaboi'
import {localSchema} from './schema.js'
import * as fs from 'node:fs'

export interface Db {
  cg: cg.CausalGraph,
  /**
   * Checked out version.
   *
   * Note there's a similar variable called cg.heads which names the 'global'
   * heads - which is what we sync. But we could be looking at an earlier
   * version.
   */
  branch: LV[],
  // val: [LV, Primitive][],
  ops: Map<number, Action>, // Local version to op. Could trim?

  agent: AgentVersion,
}

const createDb = (): Db => ({
  cg: cg.create(),
  branch: [],
  ops: new Map,
  agent: createAgent(),
})

const SAVE_FILE = process.env['DB_FILE'] || 'db.scb'

const saveNow = (schema: sb.Schema, db: Db) => {
  const data = sb.write(schema, db)

  // console.log('data', data)
  fs.writeFileSync(SAVE_FILE, data)
  console.log('Db saved to', SAVE_FILE)
}

const load = (): [sb.Schema, Db] => {
  try {
    const rawData = fs.readFileSync(SAVE_FILE)
    const [mergedSchema, db] = sb.read(localSchema, rawData)
    return [mergedSchema, db as Db]
  } catch (e: any) {
    if (e.code == 'ENOENT') {
      console.warn('Warning: Existing database does not exist. Creating a new one!')
      const db = createDb()
      saveNow(localSchema, db)
      return [localSchema, db]
    } else {
      console.error('Could not load previous database data')
      throw e
    }
  }
}

// Global singleton database for this process.
export const [storageSchema, db] = load()

const save = rateLimit(1000, () => saveNow(storageSchema, db))

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

process.on('exit', () => {
  // console.log('exit')
  save.doItNow()
})




export const getVal = (db: Db): Primitive => {
  // Empty database / branch.
  if (db.branch.length === 0) return null

  let v = cg.tieBreakVersions(db.cg, db.branch as AtLeast1<LV>)
  let op = db.ops.get(v)
  if (op == null) throw Error('Missing operation in DB')

  return op.val
}

export const set = (db: Db, val: Primitive): LV => {
  let [agentId, seq] = nextVersion(db.agent)
  let lv = cg.assignLocal(db.cg, agentId, seq, db.branch)
  db.ops.set(lv, {type: 'set', val})
  db.branch = [lv]
  save()
  return lv
}

export const getOpsInDiff = (db: Db, diff: cg.PartialSerializedCGV1): Action[] => {
  const opsToSend: Action[] = []
  for (let [agent, seq, len] of diff) {
    do {
      // Take as many as we can (max len) from agent/seq.
      // let [lv, spanLen] = cg.rawToLVSpan(from.cg, agent, seq)
      // const lenHere = min2(len, spanLen)

      let [lvStart, lvEnd] = cg.rawToLVSpan(db.cg, agent, seq)
      lvEnd = min2(lvEnd, lvStart + len)
      for (let lv = lvStart; lv < lvEnd; lv++) {
        opsToSend.push(db.ops.get(lv)!)
      }
      len -= lvEnd - lvStart
    } while (len > 0)
  }
  return opsToSend
}

