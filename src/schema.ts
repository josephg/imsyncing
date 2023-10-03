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


export const appSchema: sb.AppSchema = {
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

testSimpleRoundTrip(appSchema, 'AnyType', null)
testSimpleRoundTrip(appSchema, 'AnyType', true)
testSimpleRoundTrip(appSchema, 'AnyType', 'hi')
testSimpleRoundTrip(appSchema, 'AnyType', 123)
testSimpleRoundTrip(appSchema, 'AnyType', 123.456)
testSimpleRoundTrip(appSchema, 'AnyType', {x: 'hi'})
testSimpleRoundTrip(appSchema, 'AnyType', [1,2,'hi'])

testSimpleRoundTrip(appSchema, 'Action', {type: 'set', val: 123})
testSimpleRoundTrip(appSchema, 'CausalGraph', cg.create())
{
  const cg1 = cg.create()
  cg.addRaw(cg1, ['fred', 0], 10)
  cg.addRaw(cg1, ['george', 0], 20)
  cg.addRaw(cg1, ['george', 20], 5, [['fred', 9], ['george', 19]])

  testSimpleRoundTrip(appSchema, 'CausalGraph', cg1)
}

testSimpleRoundTrip(appSchema, 'RawVersion', ['seph', 123])

{

  const createDb = () => ({
    cg: cg.create(),
    branch: [],
    ops: new Map,
    agent: ['seph', 100],
  })
  testSimpleRoundTrip(appSchema, 'Db', createDb())

}

export const localSchema = sb.extendSchema(appSchema)
// export const schema = appSchema
