import { testSimpleRoundTrip } from "schemaboi/testhelpers.js"
import * as cg from "./causal-graph.js"
import { createDb } from "./db.js"
import { appDbSchema, appNetSchema } from './schema.js'
import * as ss from "./stateset.js"
import { NetMsg } from "./types.js"


Error.stackTraceLimit = Infinity
testSimpleRoundTrip(appDbSchema, 'AnyType', null)
testSimpleRoundTrip(appDbSchema, 'AnyType', true)
testSimpleRoundTrip(appDbSchema, 'AnyType', 'hi')
testSimpleRoundTrip(appDbSchema, 'AnyType', 123)
testSimpleRoundTrip(appDbSchema, 'AnyType', 123.456)
testSimpleRoundTrip(appDbSchema, 'AnyType', { x: 'hi' })
testSimpleRoundTrip(appDbSchema, 'AnyType', [1, 2, 'hi'])
testSimpleRoundTrip(appDbSchema, 'Op', { type: 'set', val: 123 })
testSimpleRoundTrip(appDbSchema, 'CausalGraph', cg.create())
{
  const cg1 = cg.create()
  cg.addRaw(cg1, ['fred', 0], 10)
  cg.addRaw(cg1, ['george', 0], 20)
  cg.addRaw(cg1, ['george', 20], 5, [['fred', 9], ['george', 19]])

  testSimpleRoundTrip(appDbSchema, 'CausalGraph', cg1)
}
testSimpleRoundTrip(appDbSchema, 'RawVersion', ['seph', 123])
testSimpleRoundTrip(appDbSchema, 'Db', createDb())
{
  const stateSet = ss.create()
  ss.localInsert(stateSet, ['seph', 0], 123)
  ss.localInsert(stateSet, ['seph', 1], 321)

  testSimpleRoundTrip(appDbSchema, 'StateSet', stateSet)
}

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
{
  const stateSet = ss.create()
  ss.localInsert(stateSet, ['seph', 0], 123)
  ss.localInsert(stateSet, ['seph', 1], 321)

  const delta = ss.deltaSince(stateSet)

  const helloMsg: NetMsg = {
    type: 'Hello',
    inboxVersion: cg.summarizeVersion(stateSet.cg),
    sync: 'all',
  }
  testSimpleRoundTrip(appNetSchema, 'NetMessage', helloMsg)

  const deltaMsg: NetMsg = { type: 'InboxDelta', delta }
  testSimpleRoundTrip(appNetSchema, 'NetMessage', deltaMsg)

}

