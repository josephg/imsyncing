import repl from 'node:repl'
import * as dbLib from './db.js'
import * as causalGraph from './causal-graph.js'
import * as ss from './stateset.js'
import { Db, LV, Primitive, RawVersion } from './types.js'
import { nextVersion } from './utils.js'

// ***** REPL
export default function startRepl(db: Db) {
  const r = repl.start({
    prompt: '> ',
    useColors: true,
    // terminal: true,
    // completer: true,
    ignoreUndefined: true,
  })
  r.setupHistory('.history', err => {
    if (err) throw err
  
    r.context.db = db
    r.context.cg = causalGraph
  
    r.context.insert = (val: Primitive) => {
      // db.inbox
      const key = ss.localInsert(db.inbox, nextVersion(db.agent), val)
      dbLib.emitChangeEvent(db, 'local')
      return key
    }
  
    // r.context.set = (val: Primitive) => {
    //   dbLib.set(db, val)
    // }
  
    // r.context.get1 = () => {
    //   return dbLib.getVal(db)
    // }
    r.context.get = (key: LV | RawVersion) => {
      if (Array.isArray(key)) {
        key = causalGraph.rawToLV2(db.inbox.cg, key)
      }
      // return dbLib.getAllVals(db)
  
      return ss.get(db.inbox, key)
    }
  
    r.context.getAll = () => {
      return db.inbox.values
    }
  
    r.once('exit', () => {
      process.exit(0)
    })
  
    db.listeners.add((type: 'local' | 'remote') => {
      if (type === 'remote') {
        console.log('got remote change to db')
        // console.log('new val:', dbLib.getVal(db))
      }
    })
  })
}

// r.context.getDoc = (key: LV) => {
//   const doc = docs.get(key)
//   if (doc == null) throw Error('Missing doc')
//   return dt.get(doc.doc)
// }

// // r.context.i = (val: Primitive) => {
// //   const version = agent()
// //   const lv = ss.localInsert(inbox, version, val)
// //   console.log(`Inserted ${version[0]}/${version[1]} (LV ${lv})`, val)

// //   dbDidChange()
// // }

// r.context.i = (data: Primitive) => {
//   // We'll reuse the version for the document name. It shows up as a key in
//   // the inbox as well.
//   const docKey = inboxAgent()

//   const doc = dt.createDb()
//   const docAgent = createAgent()
//   dt.recursivelySetRoot(doc, docAgent, {
//     type: 'unknown',
//     data,
//   })

//   const lv = ss.localInsert(inbox, docKey, {
//     v: causalGraph.getRawVersion(doc.cg)
//   })

//   docs.set(lv, {
//     agent: docAgent,
//     doc
//   })

//   // console.dir(doc, {depth:null})

//   console.log(`Inserted ${docKey[0]}/${docKey[1]} (LV ${lv})`, data)

//   indexDidChange()
// }

// r.context.s = (docKey: LV, val: Primitive) => {
//   const doc = docs.get(docKey)
//   if (doc == null) throw Error('Missing or invalid key')

//   dt.recursivelySetRoot(doc.doc, doc.agent, {data: val})
//   console.log(dt.get(doc.doc))

//   const version = inboxAgent()
//   const lv = ss.localSet(inbox, version, docKey, {
//     v: causalGraph.getRawVersion(doc.doc.cg)
//   })

//   console.log(`Set ${docKey} data`, val)
//   indexDidChange()
// }

// r.context.get = (docKey: LV) => dt.get(docs.get(docKey)!.doc)

// r.context.print = () => {
//   for (const [k, doc] of docs.entries()) {
//     console.log(k, ':', dt.get(doc.doc))
//   }
// }


// // r.context.i({oh: 'hai'})