import * as sb from 'schemaboi'
import {testSimpleRoundTrip} from 'schemaboi/testhelpers.js'
import { RawVersion } from "./types.js";
import * as cg from './causal-graph.js';

const LV = sb.prim('u64')

// This is stolen from SB's JSON example / test.
type JSONValueEnc = {type: 'null' | 'true' | 'false'}
  | {type: 'float', val: number}
  | {type: 'int', val: number}
  | {type: 'string', val: string}
  | {type: 'object', val: Record<string, JSONValueEnc>}
  | {type: 'list', val: JSONValueEnc[]}

const errExpr = (msg: string): any => { throw Error(msg) }

function encodePrim(val: any): JSONValueEnc {
  return val == null ? {type: 'null'}
    : val === true ? {type: 'true'}
    : val === false ? {type: 'false'}
    : typeof val === 'string' ? {type: 'string', val}
    : typeof val === 'number' ? (Number.isInteger(val) ? {type: 'int', val} : {type: 'float', val})
    : Array.isArray(val) ? {type: 'list', val}
    // : Array.isArray(obj) ? {type: 'list', val: obj.map(encode)}
    : typeof val === 'object' ? {type: 'object', val}
    // : typeof val === 'object' ? {type: 'object', val: objMap(val, encode)}
    : errExpr('Not recognised value: ' + val)
}

function decodePrim(_variant: string, val: Record<string, any> | null): any {
  const variant = _variant as JSONValueEnc['type']

  // console.log('decode', variant, val)

  switch (variant) {
    case 'null': return null
    case 'true': return true
    case 'false': return false
    case 'float': case 'int': case 'string':
    case 'list': case 'object':
      return val!.val
    default:
      let expectNever: never = variant
      throw Error('unexpected type: ' + variant)
  }
}


export const appDbSchema: sb.AppSchema = {
  id: 'SimplestSync',
  root: sb.ref('Db'),
  types: {
    Db: {
      fields: {
        cg: sb.ref('CausalGraph'),
        branch: sb.list(LV),
        ops: sb.map(LV, 'Action', 'map'),
        agent: sb.ref('RawVersion'),
      }
    },

    RawVersion: {
      exhaustive: true,
      fields: {
        id: sb.prim('id'),
        seq: LV,
      },
      encode(v: RawVersion) {
        return { id: v[0], seq: v[1] }
      },
      decode(vv: any): RawVersion { // {id: string, seq: number}
        return [vv.id, vv.seq]
      },
    },

    AnyType: {
      type: 'enum',
      exhaustive: false,
      encode: encodePrim,
      decode: decodePrim,
      variants: {
        null: null,
        true: null,
        false: null,
        string: {fields: {val: 'string'}},
        int: {fields: {val: 's64'}},
        float: {fields: {val: 'f64'}},
        object: {fields: {val: sb.map('string', 'AnyType', 'object')}},
        list: {fields: {val: sb.list('AnyType')}},
      }
    },

    Action: {
      type: 'enum',
      exhaustive: false,
      variants: {
        set: {
          fields: { val: sb.ref('AnyType') }
        }
      }
    },

    CGEntry: {
      fields: {
        version: LV,
        vEnd: LV,

        agent: sb.prim('id'),
        seq: LV, // seq for version.

        parents: sb.list(LV) // parents for version.
      }
    },

    CausalGraph: {
      fields: {
        heads: sb.list('u64'), // Could just recompute this on load?
        entries: sb.list('CGEntry'),
      },

      encode(c: cg.CausalGraph): cg.SerializedCausalGraphV1 {
        // console.log('sss', cg.serialize(c))
        return cg.serialize(c)
      },
      decode(data: any): cg.CausalGraph {
        return cg.fromSerialized(data)
      },
    },
  }
}


Error.stackTraceLimit = Infinity;

testSimpleRoundTrip(appDbSchema, 'AnyType', null)
testSimpleRoundTrip(appDbSchema, 'AnyType', true)
testSimpleRoundTrip(appDbSchema, 'AnyType', 'hi')
testSimpleRoundTrip(appDbSchema, 'AnyType', 123)
testSimpleRoundTrip(appDbSchema, 'AnyType', 123.456)
testSimpleRoundTrip(appDbSchema, 'AnyType', {x: 'hi'})
testSimpleRoundTrip(appDbSchema, 'AnyType', [1,2,'hi'])

testSimpleRoundTrip(appDbSchema, 'Action', {type: 'set', val: 123})
testSimpleRoundTrip(appDbSchema, 'CausalGraph', cg.create())
{
  const cg1 = cg.create()
  cg.addRaw(cg1, ['fred', 0], 10)
  cg.addRaw(cg1, ['george', 0], 20)
  cg.addRaw(cg1, ['george', 20], 5, [['fred', 9], ['george', 19]])

  testSimpleRoundTrip(appDbSchema, 'CausalGraph', cg1)
}

testSimpleRoundTrip(appDbSchema, 'RawVersion', ['seph', 123])

{

  const createDb = () => ({
    cg: cg.create(),
    branch: [],
    ops: new Map,
    agent: ['seph', 100],
  })
  testSimpleRoundTrip(appDbSchema, 'Db', createDb())

}



const appNetSchema: sb.AppSchema = {
  id: 'SimplestSyncNet',
  root: sb.ref('NetMessage'),
  types: {
    RawVersion: appDbSchema.types.RawVersion,
    AnyType: appDbSchema.types.AnyType,

    // VersionSummary: {

    // },

    SeqRange: { // [startSeq, endSeq].
      exhaustive: true,
      fields: { start: LV, end: LV, },
      encode(range) { return {start: range[0], end: range[1]} },
      decode(range) { return [range.start, range.end] },
    },

    NetMessage: {
      type: 'enum',
      variants: {
        Hello: {

          fields: {
            versionSummary: sb.map('string', 'SeqRange')
          }
        }
      }
    }
  }
}

testSimpleRoundTrip(appNetSchema, 'NetMessage', {type: 'Hello', versionSummary: {seph: [0, 23]}})




export const localDbSchema = sb.extendSchema(appDbSchema)
export const localNetSchema = sb.extendSchema(appNetSchema)
// export const schema = appSchema
