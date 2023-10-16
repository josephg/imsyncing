import * as causalGraph from "./causal-graph.js";
import { LV, NetMsg, VersionSummary, Db, DocName } from "./types.js";
import { resolvable, wait } from "./utils.js";
import * as database from './db.js'
// import * as ss from './stateset.js'
import * as net from 'node:net'

import { localNetSchema } from "./schema.js";
import handle from "./message-stream.js";
import { finished } from "node:stream";
import startRepl from './repl.js'
import { entriesBetween } from "./last-modified-index.js";
// import { modifiedKeysSince } from "./last-modified-index.js";

import { DbEntryDiff, serializePartialSince } from "./db-entry.js";
import {Console, assert} from 'node:console'
const console = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: {depth: null}
})
Error.stackTraceLimit = Infinity


const runProtocol = (sock: net.Socket, db: Db): Promise<void> => {
  type ProtocolState = {
    state: 'waitingForHello'
  } | {
    state: 'established',

    gotFirstDelta: boolean,

    /** Versions the remote peer has that we don't have yet. */
    unknownVersions: Map<DocName, VersionSummary | null>,

    // remoteVersions: Map<DocName, {
    //   // /**
    //   //  * The version that we expect the remote peer to have.
    //   //  * This includes sent versions that haven't been acknowledged yet.
    //   //  *
    //   //  * It is always <= our current version.
    //   //  *
    //   //  * The remoteVersion on all connected peers will generally move in lockstep.
    //   //  * We still have this value here because if we're connected to 2 peers, we
    //   //  * update remoteVersion when we get deltas from one peer and that way we know
    //   //  * not to reflect the changes back to that peer.
    //   //  */
    //   // remoteVersion: LV[],

    //   // /** Versions the remote peer has that we don't have yet. */
    //   // unknownVersions: VersionSummary | null
    // }>,

  }

  let state: ProtocolState = { state: 'waitingForHello' }

  const finishPromise = resolvable()


  // const sendInboxDelta = (sinceVersion: LV[]) => {
  //   console.log('sending delta to', sock.remoteAddress, sock.remotePort, 'since', sinceVersion)
  //   const delta = ss.deltaSince(db.inbox, sinceVersion)
  //   write({ type: 'InboxDelta', delta })
  // }

  const onVersionChanged = (from: 'local' | 'remote', changed: Set<[docName: DocName, oldHeads: LV[]]>, deltasToSend: Map<DocName, DbEntryDiff>) => {
    console.log('onVersionChanged', state, changed)
    if (state.state !== 'established') throw Error('Unexpected connection state')

    for (const [docName, _oldHead] of changed) {
      const entry = db.entries.get(docName)!
      const cg = entry.cg

      const unknownVersions = state.unknownVersions.get(docName)
      if (unknownVersions != null) {
        // The db might now include part of the remainder. Doing this works
        // around a bug where connecting to 2 computers will result in
        // re-sending known changes back to them.
        // console.log('unknown', state.unknownVersions)
        const [sinceVersion, newUnknownVersions] = causalGraph.intersectWithSummary(
          cg, unknownVersions, cg.heads
          // cg, unknownVersions, state.remoteVersion
        )
        if (newUnknownVersions == null) {
          // We've got all the versions
          assert(causalGraph.lvEq(sinceVersion, cg.heads))
          console.log('got all versions', docName)
          state.unknownVersions.delete(docName)
        } else {
          // console.log('->known', newUnknownVersions)
          state.unknownVersions.set(docName, newUnknownVersions)
        }
      }
    }

    if (deltasToSend.size > 0) {
      write({ type: 'DocDeltas', deltas: deltasToSend })
    }
  }


  const {close, write} = handle<NetMsg>(sock, localNetSchema, (msg, sock) => {
    console.log('got net msg', msg)

    switch (msg.type) {
      case 'Hello': {
        if (state.state !== 'waitingForHello') throw Error('Unexpected connection state')

        // We've gotten the version of all the DB entries. Compare it to the local entries
        // and send any versions to the peer that its missing.
        const deltasToSend = new Map<DocName, DbEntryDiff>()
        const unknownVersions = new Map<DocName, VersionSummary | null>()

        for (const [k, summary] of msg.versions) {
          const entry = db.entries.get(k)
          if (entry == null) continue // The remote peer will discover this and fill us in soon.

          // We're looking for versions *we* have that the other peer is missing.

          const cg = entry.cg
          const [sinceVersion, remainder] = causalGraph.intersectWithSummary(cg, summary)
          // console.log('known idx version', sinceVersion)
          if (remainder != null) {
            // We have some local changes to send.
            assert(!causalGraph.lvEq(sinceVersion, cg.heads))

            console.log('send delta', k, sinceVersion)
            // sendDelta(sv)

            deltasToSend.set(k, serializePartialSince(entry, sinceVersion))
          }

          unknownVersions.set(k, remainder)
        }

        for (const [k, entry] of db.entries) {
          if (msg.versions.has(k)) continue
          // Entry doesn't appear in the remote's set at all. Add it to the deltas to send.
          deltasToSend.set(k, serializePartialSince(entry, []))
        }

        // We always send a deltas message, even if it has no changes so the other peer
        // knows they're up to date.
        write({ type: 'DocDeltas', deltas: deltasToSend })


        state = {
          state: 'established',
          gotFirstDelta: false,
          // remoteVersion: cg.heads.slice(),
          // remoteVersion: sinceVersion,
          unknownVersions,
        }

        db.listeners.add(onVersionChanged)
        break
      }

      case 'DocDeltas': {
        if (state.state !== 'established') throw Error('Invalid state')
        state.gotFirstDelta = true

        const changed = new Set<[DocName, LV[]]>()
        for (const [k, delta] of msg.deltas) {
          const oldEntry = db.entries.get(k)
          const oldHead = oldEntry ? oldEntry.cg.heads.slice() : []
          const [start, end] = database.mergeEntryDiff(db, k, delta)

          // Presumably the remote peer has just sent us all the data it has that we were
          // missing. I could call intersectWithSummary2 here, but this should be
          // sufficient.
          state.unknownVersions.delete(k)

          // TODO: Consider emitting a single event no matter how many change.
          if (end !== start) {
            changed.add([k, oldHead])
          }
        }
        if (changed.size > 0) {
          database.emitChangeEvent(db, 'remote', changed)
        }

        break
      }

      // case 'InboxDelta': {
      //   if (state.state !== 'established') throw Error('Invalid state')

      //   // console.log('got delta', msg.cg, msg.ops)

      //   // Importantly, the notify event will fire after other syncronous stuff we do here.
      //   const updated = ss.mergeDelta(db.inbox, msg.delta)
      //   // database.mergeDelta(db, msg.cg, msg.ops)

      //   const cg = db.inbox.cg

      //   state.remoteVersion = causalGraph.advanceVersionFromSerialized(
      //     cg, msg.delta.cg, state.remoteVersion
      //   )
      //   // TODO: Ideally, this shouldn't be necessary! But it is because the remoteVersion
      //   // also gets updated as a result of versions *we* send.
      //   state.remoteVersion = causalGraph.findDominators(cg, state.remoteVersion)
      //   console.log('new inbox version', state.remoteVersion)

      //   // Presumably the remote peer has just sent us all the data it has that we were
      //   // missing. I could call intersectWithSummary2 here, but this should be
      //   // sufficient.
      //   state.unknownVersions = null

      //   if (updated[0] !== updated[1]) {
      //     for (const {key} of entriesBetween(db.inbox.index, updated[0], updated[1])) {
      //       console.log('Modified inbox key', key)
      //     }
      //   }

      //   database.emitChangeEvent(db, 'local')
      //   break
      // }

      // default:
      //   console.warn('Unrecognised network message', msg.type)
    }
  })

  finished(sock, (err) => {
    console.log('Socket closed', sock.remoteAddress, sock.remotePort)
    db.listeners.delete(onVersionChanged)
    close()

    if (err) finishPromise.reject(err)
    else finishPromise.resolve()
  })

  write({
    type: 'Hello',
    sync: db.syncConfig,
    versions: database.getAllSummaries(db),
  })

  return finishPromise.promise
}

const serverOnPort = (port: number, db: Db) => {
  const server = net.createServer(async sock => {
    console.log('got server socket connection', sock.remoteAddress, sock.remotePort)
    runProtocol(sock, db)
    // handler.write({oh: 'hai'})
  })

  server.listen(port, () => {
    console.log(`Server listening on port ${port}`)
  })
}

const connect1 = (host: string, port: number, db: Db) => {
  const sock = net.connect({port, host}, () => {
    console.log('connected!')
    runProtocol(sock, db)
  })
}


const connect = (host: string, port: number, db: Db) => {
  ;(async () => {
    while (true) {
      console.log('Connecting to', host, port, '...')
      const socket = new net.Socket()
      const connectPromise = resolvable()
      socket.once('connect', connectPromise.resolve)
      socket.once('error', connectPromise.reject)
      socket.connect({port, host})

      try {
        await connectPromise.promise
        socket.removeListener('error', connectPromise.reject)
        await runProtocol(socket, db)
      } catch (e: any) {
        console.warn('Could not connect:', e.message)
      }

      console.log('Reconnecting in 3 seconds...')
      await wait(3000)
    }
  })()
}


// ***** Command line argument passing
{
  const db = database.createOrLoadDb() // TODO: Use path from command line

  for (let i = 2; i < process.argv.length; i++) {
    const command = process.argv[i]
    switch (command) {
      case '-l': {
        const port = +process.argv[++i]
        if (port === 0 || isNaN(port)) throw Error('Invalid port (usage -l <PORT>)')

        serverOnPort(port, db)
        break
      }

      case '-c': {
        const host = process.argv[++i]
        if (host == null) throw Error('Missing host to connect to! (usage -c <HOST> <PORT>')
        const port = +process.argv[++i]
        if (port === 0 || isNaN(port)) throw Error('Invalid port (usage -c <HOST> <PORT>)')

        connect(host, port, db)
        console.log('connect', host, port)
        break
      }

      // case '-f': {
      //   const f = process.argv[++i]
      //   loadFromFile(f)

      //   break
      // }

      default: {
        throw Error(`Unknown command line argument '${command}'`)
      }
    }
    // console.log(process.argv[i])
  }

  startRepl(db)
}

// const server = net.createServer(async sock => {
//   console.log('got server socket connection', sock.remoteAddress, sock.remotePort)
//   runProtocol(sock)
// })

// server.listen(9888)
// console.log('listening on port 9888')




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