import * as sb from 'schemaboi'
import { Pair, DbEntry, LV, NetMsg, Primitive, RawVersion, RegisterValue } from "./types.js";
import * as cg from './causal-graph.js';
import EventEmitter from 'events';
import { Db } from "./types.js";
import * as ss from './stateset.js';
import { hydrateIndex } from './db-entry.js';

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
        entries: sb.map(sb.Id, sb.ref('DbEntry'), 'map'), // Not yet used.
        agent: sb.Id,
        syncConfig: sb.ref('SyncConfig'),
        listeners: {
          type: 'ref', key: 'notused',
          skip: true,
          defaultValue: () => new Set(),
        }
      },

      decode(db) {
        for (const entry of db.entries.values()) {
          entry.nextSeq = cg.nextSeqForAgent(entry.cg, db.agent)
        }
        return db
      }
    },

    DbEntry: {
      fields: {
        // Using a s64 here because ROOT encodes as -1. Could instead +1 / -1 the CRDT keys.
        crdts: {
          ...sb.map(LV, sb.ref('CRDTValue'), 'map'),
          encodeEntry(e) {
            e[0] += 1
            return e
          },
          decodeEntry(e) {
            e[0] -= 1
            return e
          },
        },
        cg: sb.ref('CausalGraph'),
        index: {
          type: LV.type,
          skip: true,
          defaultValue: () => ([]),
        },
        storesHistory: sb.Bool,
        branch: sb.list(LV),
        nextSeq: {type: LV.type, skip: true},
        appType: sb.Id,
      },
      decode(entry) {
        hydrateIndex(entry as DbEntry)
        return entry
      },
    },

    CRDTValue: {
      type: 'enum',
      variants: {
        register: { fields: { value: sb.list(sb.ref('RegisterValuePair')) } },
        map: { fields: { registers: sb.map(sb.ref('MapKey'), sb.list(sb.ref('RegisterValuePair')), 'map') } },
      },
    },

    SyncConfig: {
      type: 'enum',
      variants: ['all', 'none'],
      decode(variant, data) { return variant },
      encode(variant) { return {type: variant} }
    },

    RawVersion: {
      // exhaustive: true,
      fields: { id: sb.Id, seq: LV },
      encode(v: RawVersion) {
        return { id: v[0], seq: v[1] }
      },
      decode(vv: any): RawVersion { // {id: string, seq: number}
        return [vv.id, vv.seq]
      },
    },

    // Op: {
    //   type: 'enum',
    //   exhaustive: false,
    //   variants: {
    //     set: {
    //       fields: { val: sb.ref('Primitive') }
    //     }
    //   }
    // },

    Primitive: {
      type: 'enum',
      exhaustive: false,
      encode: encodePrim,
      decode: decodePrim,
      variants: {
        null: null,
        true: null,
        false: null,
        string: {fields: {val: sb.String}},
        int: {fields: {val: 's64'}},
        float: {fields: {val: 'f64'}},
        list: {fields: {val: sb.list('Primitive')}},
        object: {fields: {val: sb.map(sb.String, 'Primitive', 'object')}},
        // TODO: Or a reference to another nearby CRDT.
      }
    },

    RegisterValue: {
      type: 'enum',
      variants: {
        primitive: {fields: {val: sb.ref('Primitive')}},
        crdt: null,
      }
    },

    RegisterValuePair: {
      fields: {
        lv: LV,
        val: sb.ref('RegisterValue')
      },
      encode(pair: Pair<RegisterValue>) {
        return {lv: pair[0], val: pair[1]}
      },
      decode(obj) {
        return [obj.lv, obj.val]
      },
    },

    MapKey: {
      type: 'enum',
      exhaustive: false,
      encode: encodePrim,
      decode: decodePrim,
      variants: {
        true: null,
        false: null,
        string: {fields: {val: sb.String}}, // Or ID?
        int: {fields: {val: 's64'}},
      }
    },

    CGEntry: {
      fields: {
        version: LV,
        vEnd: LV,

        agent: sb.Id,
        seq: LV, // seq for version.

        parents: sb.list(LV) // parents for version.
      }
    },

    // SSPair: {
    //   fields: {
    //     lv: LV,
    //     val: sb.ref('Primitive'),
    //   },
    //   encode(pair: [LV, Primitive]) {
    //     return { lv: pair[0], val: pair[1] }
    //   },
    //   decode(pair: any): RawVersion { // {id: string, seq: number}
    //     return [pair.lv, pair.val]
    //   },
    // },

    // StateSet: {
    //   fields: {
    //     values: sb.map(LV, sb.list(sb.ref('SSPair')), 'map'),
    //     cg: sb.ref('CausalGraph')
    //   },
    //   decode({values, cg}: any): ss.StateSet {
    //     return ss.hydrate(values, cg)
    //   }
    // },

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

const versionSummarySchema = sb.map(sb.Id, sb.list('SeqRange'), 'object')

export const appNetSchema: sb.AppSchema = {
  id: 'SimplestSyncNet',
  root: sb.ref('NetMessage'),
  types: {
    RawVersion: appDbSchema.types.RawVersion,
    // Op: appDbSchema.types.Op,
    Primitive: appDbSchema.types.Primitive,
    SyncConfig: appDbSchema.types.SyncConfig,
    RegisterValue: appDbSchema.types.RegisterValue,
    MapKey: appDbSchema.types.MapKey,

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
        agent: sb.Id,
        seq: LV,
        len: LV,
        parents: sb.list('RawVersion')
      }
    },

    CreateValue: {
      type: 'enum',
      variants: {
        primitive: { fields: { val: sb.ref('Primitive') } },

        // Or create a register, map or set.
        register: null,
        map: null,
        // set: null,
      }
    },

    MVRegisterSet: {
      fields: {
        offset: LV,
        val: sb.ref('CreateValue')
      }
    },

    CRDTDiff: {
      type: 'enum',
      variants: {
        register: { fields: {
          set: sb.list(sb.ref('MVRegisterSet'))
        }},
        map: { fields: {
          registers: sb.map(sb.ref('MapKey'), sb.list(sb.ref('MVRegisterSet')), 'map'),
        }},
      },
    },

    CRDTDiffPair: {
      fields: {
        v: sb.ref('RawVersion'),
        diff: sb.ref('CRDTDiff'),
      }
    },

    DbEntryDiff: {
      fields: {
        appType: sb.Id,
        cg: sb.list('PartialSerializedCGEntry'),
        // TODO: Could represent this as a map? Its sorted, but I don't want to
        // rely on the map sort order through SB.
        crdtDiffs: sb.list(sb.ref('CRDTDiffPair'))
      }

    },

    NetMessage: {
      type: 'enum',
      variants: {
        Hello: {
          fields: {
            // Versions is a map of
            versions: sb.map(sb.Id, versionSummarySchema, 'map'),
            sync: sb.ref('SyncConfig'),
          }
        },

        DocDeltas: {
          fields: {
            deltas: sb.map(sb.Id, sb.ref('DbEntryDiff'), 'map'),
          }
        }

        // InboxDelta: {
        //   fields: {
        //     delta: sb.ref('SSDelta'),
        //     // cg: sb.list('PartialSerializedCGEntry'),
        //     // ops: sb.map(LV, 'Op', 'map'),
        //   }
        // }
      }
    }
  }
}

export const localDbSchema = sb.extendSchema(appDbSchema)
export const localNetSchema = sb.extendSchema(appNetSchema)
// export const schema = appSchema
