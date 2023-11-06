import { createRandomId } from "./utils.js";
import { Db, DocName, LV, LVRange, Primitive, ROOT_LV, RuntimeContext, VersionSummary } from "./types.js"
import * as causalGraph from "./causal-graph.js"
import { DbEntryDiff, createDbEntry, mergePartialDiff, recursivelySetMap, recursivelySetRoot } from "./db-entry.js";
import { emit1DocChanged } from "./runtimectx.js";

export const createDb = (agent: string = createRandomId()): Db => ({
  // inbox: ss.create(),
  entries: new Map(),
  agent,
  syncConfig: 'all',
})

export function getAllSummaries(db: Db): Map<DocName, VersionSummary> {
  const result = new Map
  for (const [k, entry] of db.entries) {
    const summary = causalGraph.summarizeVersion(entry.cg)
    result.set(k, summary)
  }
  return result
}

export function insertNewEntry(db: Db, appType: string, val?: Record<string, Primitive>): DocName {
  const docName = createRandomId()
  const entry = createDbEntry(appType)
  db.entries.set(docName, entry)
  if (val != null) recursivelySetRoot(entry, db.agent, val)
  return docName
}

export function insertAndNotify(ctx: RuntimeContext, appType: string, val?: Record<string, Primitive>): DocName {
  const docName = insertNewEntry(ctx.db, appType, val)
  // Because nobody knows about this document yet, globalKnownVersions defaults to []
  // - which is correct.
  // ctx.globalKnownVersions.set(docName, []) // Nobody knows about this document yet.

  // Firing this asyncronously, since the new entry
  // will probably be modified now.
  // setImmediate(() => emitChangeEvent1(db, 'local', docName, []))
  // emitChangeEvent1(ctx, 'local', docName, [])
  emit1DocChanged(ctx, 'local', docName)

  return docName
}

export function mergeEntryDiff(db: Db, name: DocName, diff: DbEntryDiff): LVRange {
  let localEntry = db.entries.get(name)
  if (localEntry == null) {
    localEntry = createDbEntry(diff.appType)
    db.entries.set(name, localEntry)
  } else {
    if (localEntry.appType !== diff.appType) throw Error('Conflicting app type for doc ' + name)
  }

  const range = mergePartialDiff(localEntry, diff)
  return range
}

export function setAndNotify(ctx: RuntimeContext, name: DocName, val: Record<string, Primitive>, container: LV = ROOT_LV) {
  const entry = ctx.db.entries.get(name)
  if (entry == null) throw Error('Missing entry ' + name)

  // const oldHead = entry.cg.heads.slice()
  const start = causalGraph.nextLV(entry.cg)
  recursivelySetMap(entry, ctx.db.agent, container, val)

  if (start !== causalGraph.nextLV(entry.cg)) {
    // emitChangeEvent1(ctx, 'local', name, oldHead)
    emit1DocChanged(ctx, 'local', name)
  }
}


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
