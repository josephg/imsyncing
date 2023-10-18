import { testSimpleRoundTrip } from "schemaboi/testhelpers.js"
import * as cg from "../src/causal-graph.js"
import * as database from "../src/db.js"
import { appDbSchema, appNetSchema, localDbSchema } from '../src/schema.js'
import { NetMsg, RuntimeContext } from "../src/types.js"

import {Console} from 'node:console'
const console = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: {depth: null}
})

Error.stackTraceLimit = Infinity
testSimpleRoundTrip(appDbSchema, 'Primitive', null)
testSimpleRoundTrip(appDbSchema, 'Primitive', true)
testSimpleRoundTrip(appDbSchema, 'Primitive', 'hi')
testSimpleRoundTrip(appDbSchema, 'Primitive', 123)
testSimpleRoundTrip(appDbSchema, 'Primitive', 123.456)
testSimpleRoundTrip(appDbSchema, 'Primitive', { x: 'hi' })
testSimpleRoundTrip(appDbSchema, 'Primitive', [1, 2, 'hi'])
// testSimpleRoundTrip(appDbSchema, 'Op', { type: 'set', val: 123 })
testSimpleRoundTrip(appDbSchema, 'CausalGraph', cg.create())
{
  const cg1 = cg.create()
  cg.addRaw(cg1, ['fred', 0], 10)
  cg.addRaw(cg1, ['george', 0], 20)
  cg.addRaw(cg1, ['george', 20], 5, [['fred', 9], ['george', 19]])

  testSimpleRoundTrip(appDbSchema, 'CausalGraph', cg1)
}
testSimpleRoundTrip(appDbSchema, 'RawVersion', ['seph', 123])
// testSimpleRoundTrip(appDbSchema, 'Db', db.createDb())
// {
//   const stateSet = ss.create()
//   ss.localInsert(stateSet, ['seph', 0], 123)
//   ss.localInsert(stateSet, ['seph', 1], 321)

//   testSimpleRoundTrip(appDbSchema, 'StateSet', stateSet)
// }

// {
//   let helloMsg: NetMsg = {type: 'Hello', inboxVersion: {seph: [[0, 23]]}}
//   testSimpleRoundTrip(appNetSchema, 'NetMessage', helloMsg)
//   let deltaMsg: NetMsg = {
//     type: 'Delta',
//     cg: [{agent: 'fred', seq: 2, len: 2, parents: []}],
//     ops: new Map([
//       [1, {type: 'set', val: 'hello'}]
//     ])
//   }
//   testSimpleRoundTrip(appNetSchema, 'NetMessage', deltaMsg)
// }
// {
//   const stateSet = ss.create()
//   ss.localInsert(stateSet, ['seph', 0], 123)
//   ss.localInsert(stateSet, ['seph', 1], 321)

//   const delta = ss.deltaSince(stateSet)

//   const helloMsg: NetMsg = {
//     type: 'Hello',
//     inboxVersion: cg.summarizeVersion(stateSet.cg),
//     sync: 'all',
//   }
//   testSimpleRoundTrip(appNetSchema, 'NetMessage', helloMsg)

//   const deltaMsg: NetMsg = { type: 'InboxDelta', delta }
//   testSimpleRoundTrip(appNetSchema, 'NetMessage', deltaMsg)

// }

{
  const db = database.createDb()
  testSimpleRoundTrip(appDbSchema, 'Db', db)

  {
    const helloMsg: NetMsg = {
      type: 'Hello',
      sync: 'all',
      versions: database.getAllSummaries(db),
    }
    // console.log(helloMsg)
    testSimpleRoundTrip(appNetSchema, 'NetMessage', helloMsg)
  }


  database.insertNewEntry(db, 'post', {cool: true})

  // console.log('db', db)
  testSimpleRoundTrip(appDbSchema, 'Db', db)

  {
    const helloMsg: NetMsg = {
      type: 'Hello',
      sync: 'all',
      versions: database.getAllSummaries(db),
    }
    // console.log(helloMsg)
    testSimpleRoundTrip(appNetSchema, 'NetMessage', helloMsg)
  }

  {
    const ctx: RuntimeContext = {
      db,
      globalKnownVersions: new Map,
      listeners: new Set,
    }
    ctx.listeners.add((_from, _changed, deltas) => {
      // console.log('deltas', deltas)
      const msg: NetMsg = {
        type: 'DocDeltas',
        deltas
      }
      testSimpleRoundTrip(appNetSchema, 'NetMessage', msg)
    })
    database.insertAndNotify(ctx, 'blah', {cool: false})
  }


}