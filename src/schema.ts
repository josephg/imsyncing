import * as sb from 'schemaboi'
import { LV, NetMsg, Primitive, RawVersion } from "./types.js";
import * as cg from './causal-graph.js';
import EventEmitter from 'events';
import { Db } from './db.js';
import * as ss from './stateset.js';

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
        // cg: sb.ref('CausalGraph'),
        // branch: sb.list(LV),
        // ops: sb.map(LV, 'Op', 'map'),

        inbox: sb.ref('StateSet'),
        entries: sb.map(LV, LV, 'map'), // Not yet used.
        agent: sb.ref('RawVersion'),
        syncConfig: sb.ref('SyncConfig'),
        listeners: {
          type: 'ref', key: 'notused',
          skip: true,
          defaultValue: () => new Set(),
        }
      }
    },

    SyncConfig: {
      type: 'enum',
      variants: ['all', 'none'],
      decode(variant, data) { return variant },
      encode(variant) { return {type: variant} }
    },

    RawVersion: {
      // exhaustive: true,
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

    Op: {
      type: 'enum',
      exhaustive: false,
      variants: {
        set: {
          fields: { val: sb.ref('AnyType') }
        }
      }
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


    CGEntry: {
      fields: {
        version: LV,
        vEnd: LV,

        agent: sb.prim('id'),
        seq: LV, // seq for version.

        parents: sb.list(LV) // parents for version.
      }
    },

    SSPair: {
      fields: {
        lv: LV,
        val: sb.ref('AnyType'),
      },
      encode(pair: [LV, Primitive]) {
        return { lv: pair[0], val: pair[1] }
      },
      decode(pair: any): RawVersion { // {id: string, seq: number}
        return [pair.lv, pair.val]
      },
    },

    StateSet: {
      fields: {
        values: sb.map(LV, sb.list(sb.ref('SSPair')), 'map'),
        cg: sb.ref('CausalGraph')
      },
      decode({values, cg}: any): ss.StateSet {
        return ss.hydrate(values, cg)
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


export const appNetSchema: sb.AppSchema = {
  id: 'SimplestSyncNet',
  root: sb.ref('NetMessage'),
  types: {
    RawVersion: appDbSchema.types.RawVersion,
    Op: appDbSchema.types.Op,
    AnyType: appDbSchema.types.AnyType,
    SyncConfig: appDbSchema.types.SyncConfig,

    // VersionSummary: {

    // },

    SeqRange: { // [startSeq, endSeq].
      exhaustive: true,
      fields: { start: LV, end: LV, },
      encode(range) { return {start: range[0], end: range[1]} },
      decode(range) { return [range.start, range.end] },
    },

    PartialSerializedCGEntry: {
      fields: {
        agent: sb.prim('id'),
        seq: LV,
        len: LV,
        parents: sb.list('RawVersion')
      }
    },

    SSDeltaOp: {
      fields: {
        vOffset: LV,
        key: sb.ref('RawVersion'),
        val: sb.ref('AnyType'),
      }
    },

    SSDelta: {
      fields: {
        cg: sb.list('PartialSerializedCGEntry'),
        ops: sb.list('SSDeltaOp'),
      }
    },

    NetMessage: {
      type: 'enum',
      variants: {
        Hello: {
          fields: {
            inboxVersion: sb.map('string', sb.list('SeqRange')),
            sync: sb.ref('SyncConfig'),
          }
        },

        InboxDelta: {
          fields: {
            delta: sb.ref('SSDelta'),
            // cg: sb.list('PartialSerializedCGEntry'),
            // ops: sb.map(LV, 'Op', 'map'),
          }
        }
      }
    }
  }
}

export const localDbSchema = sb.extendSchema(appDbSchema)
export const localNetSchema = sb.extendSchema(appNetSchema)
// export const schema = appSchema
