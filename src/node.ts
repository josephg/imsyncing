import * as cg from "./causal-graph.js";
import { Action, AtLeast1, LV, Primitive, RawOperation, RawVersion } from "./types.js";
import { AgentVersion, createAgent, min2, nextVersion } from "./utils.js";
import * as sb from 'schemaboi'
import * as db from './db.js'

import {Console} from 'node:console'
const console = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: {depth: null}
})

// let cg = CG.create()



// let agent = createAgent()

const mergeFrom = (into: db.Db, from: db.Db) => {
  // let fromHeads = cg.lvToRawList(from.cg, from.cg.heads)
  let vs = cg.summarizeVersion(into.cg)

  const [common, remainder] = cg.intersectWithSummary(from.cg, vs)
  console.log('common', common, 'rem', remainder)

  // The remainder gives us a bunch of ranges of versions to send, and common
  // is the most recent common LV.

  const cgDiff = cg.serializeFromVersion(from.cg, common)
  console.log('sd', cgDiff)


  // And we need to grab & merge all the deltas.
  const opsToSend = db.getOpsInDiff(from, cgDiff)
  console.log('ops', opsToSend)

  let opIdx = 0
  // Ok now merge everything. Merge the CG changes...
  // let [start, end] = cg.mergePartialVersions(into.cg, cgDiff)
  for (const [agent, seq, len, parents] of cgDiff) {
    let entry = cg.addRaw(into.cg, [agent, seq], len, parents)
    if (entry == null) {
      // We've already recieved these versions.
      opIdx += len
    } else {
      for (let i = 0; i < len; i++) {
        let op = opsToSend[opIdx++]
        into.ops.set(entry.version + i, op)
      }
      // And advance into's branch by the new entry.
      into.branch = cg.advanceFrontier(into.branch, entry.vEnd - 1, entry.parents)
    }
  }
}

// // Lets add some data.
// const db = createDb()
// // console.log(getVal(db))
// set(db, {waffles: 123})
// // console.log(getVal(db))
// // console.log(db)

// const db2 = createDb()
// set(db2, "whoa")
// // console.log(cg.lvToRawList(db.cg, db.cg.heads), cg.lvToRawList(db2.cg, db2.cg.heads))
// mergeFrom(db2, db)
// mergeFrom(db, db2)
// console.log('db', db)
// console.log('db2', db2)

// console.log('val', getVal(db), getVal(db2))
// set(db, "xxx")
// console.log('db', db)
// console.log('val', getVal(db))