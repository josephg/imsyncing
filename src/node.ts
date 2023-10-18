import * as causalGraph from "./causal-graph.js";
import { LV, NetMsg, VersionSummary, Db, DocName, RuntimeContext, DbEntry } from "./types.js";
import { emit, resolvable, wait } from "./utils.js";
import * as database from './db.js'
// import * as ss from './stateset.js'
import * as net from 'node:net'

import { localNetSchema } from "./schema.js";
import handle from "./message-stream.js";
import { finished } from "node:stream";
import startRepl from './repl.js'
// import { modifiedKeysSince } from "./last-modified-index.js";

import { DbEntryDiff, serializePartialSince } from "./db-entry.js";
import {Console, assert} from 'node:console'
import { emitDocsChanged } from "./runtimectx.js";
const console = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: {depth: null}
})
Error.stackTraceLimit = Infinity


const runProtocol = (sock: net.Socket, ctx: RuntimeContext): Promise<void> => {
  type ProtocolState = {
    /** We haven't recieved any messages from this peer yet */
    state: 'waitingForHello'
  } | {
    /**
     * We've gotten the first message saying the version of everything, but haven't
     * gotten any deltas yet.
     */
    state: 'waitingForFirstDeltas',

    /** Versions the remote peer has told us that it has, but we don't have yet. */
    unknownVersions: Map<DocName, VersionSummary>,
  } | {
    /**
     * We've established a connection and recieved our first chunk of document deltas.
     */
    state: 'established',

    /**
     * When this peer is ahead of the global known versions (ie, we've recieved a message
     * from a peer with a version but haven't broadcast that version back out to other peers
     * yet), that version gets marked here.
     */
    versionOverlay: Map<DocName, LV[]>,
  }

  let state: ProtocolState = { state: 'waitingForHello' }

  const finishPromise = resolvable()

  const db = ctx.db
  const onVersionChanged = (_from: 'local' | 'remote', changed: Set<DocName>, deltas: Map<DocName, DbEntryDiff>) => {
    // console.log('onVersionChanged', state, changed, deltas)

    // We're fundamentally in 2 different states when this method is called:
    // 1. We're in the 'waitingForFirstDeltas' state, where we know some versions
    //    the peer has that we're missing, but we don't have those versions yet.
    //    In this case, the deltas we're sending now *MUST NOT* have come from
    //    that peer. (They're either local changes or come from other peers).
    //    However, the changes we send need to be trimmed by the unknownVersions
    //    to get around a bug where we reconnect to 2 peers at once and send them
    //    changes they definitely have back to them.
    //
    // 2. We're in the 'established' state. In this case, we have all the deltas
    //    from the remote peer. But the remote peer might have just sent us the
    //    deltas we're broadcasting out now. To avoid sending its own deltas
    //    back out, we'll trim the outgoing message by the peer's overlay.

    if (state.state !== 'waitingForFirstDeltas' && state.state !== 'established') {
       throw Error('Unexpected connection state')
    }

    // We'll default to sending the (cached) deltas in the function argument. But if
    // we need to modify the message, we'll override it with this.
    let localDeltas: Map<DocName, DbEntryDiff> | null = null
    const insteadSendFrom = (docName: DocName, entry: DbEntry, heads: LV[]) => {
      if (localDeltas == null) localDeltas = new Map(deltas)

      if (causalGraph.lvEq(heads, entry.cg.heads)) {
        // We're already up to date. Skip sending this at all.
        console.log('Skipping sending update to peer for doc', docName)
        localDeltas.delete(docName)
      } else {
        localDeltas.set(docName, serializePartialSince(entry, heads))
      }
    }

    for (const docName of changed) {
      const entry = db.entries.get(docName)!

      if (state.state === 'waitingForFirstDeltas') {
        // Trim the message we send by unknown versions the peer already knows about.
        const cg = entry.cg

        const unknownVersions = state.unknownVersions.get(docName)
        if (unknownVersions != null) {
          // The db might now include part of the remainder. Doing this works
          // around a bug where connecting to 2 computers will result in
          // re-sending known changes back to them.
          // console.log('unknown', state.unknownVersions)
          const [commonVersion, newUV] = causalGraph.intersectWithSummary(
            cg, unknownVersions, cg.heads
            // cg, unknownVersions, state.remoteVersion
          )

          insteadSendFrom(docName, entry, commonVersion)

          if (newUV == null) {
            // The remote peer might still be missing versions, but we have all of its
            // versions.
            // assert(causalGraph.lvEq(commonVersion, cg.heads))
            // console.log('got all versions', docName)
            state.unknownVersions.delete(docName)
          } else {
            // console.log('->known', newUnknownVersions)
            state.unknownVersions.set(docName, newUV)
          }
        }

      } else if (state.state === 'established') {
        const overlay = state.versionOverlay.get(docName)
        if (overlay != null) {
          insteadSendFrom(docName, entry, overlay)
        }
        state.versionOverlay.delete(docName)
      }
    }

    const sendDeltas = localDeltas ?? deltas
    if (sendDeltas.size > 0) {
      write({ type: 'DocDeltas', deltas: sendDeltas })
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
        const unknownVersions = new Map<DocName, VersionSummary>()

        for (const [k, summary] of msg.versions) {
          const entry = db.entries.get(k)

          // We're looking for versions *we* have that the other peer is missing.

          // const cg = entry.cg
          const [commonVersion, remainder] = entry == null
            ? [[], summary]
            : causalGraph.intersectWithSummary(entry.cg, summary)

          // console.log('known idx version', sinceVersion)

          // Note there's 2 things going on here:
          // 1. We might have changes the remote peer is missing. (commonVersion != heads).
          // 2. The remote peer may have changes we don't have. (remainder != null)
          // These are independent!

          if (entry != null && !causalGraph.lvEq(commonVersion, entry.cg.heads)) {
            // We have some local changes to send.
            assert(!causalGraph.lvEq(commonVersion, entry.cg.heads))

            // console.log('send delta', k, commonVersion)
            deltasToSend.set(k, serializePartialSince(entry, commonVersion))
          }

          if (remainder != null) unknownVersions.set(k, remainder)
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
          state: 'waitingForFirstDeltas',
          unknownVersions,
        }

        ctx.listeners.add(onVersionChanged)
        break
      }

      case 'DocDeltas': {
        let unknownVersions: null | Map<DocName, VersionSummary> = null
        if (state.state === 'waitingForFirstDeltas') {
          // The first message must contain all the versions we were missing.
          unknownVersions = state.unknownVersions

          state = {
            state: 'established',
            versionOverlay: new Map()
          }
        }

        if (state.state !== 'established') throw Error('Invalid state')

        const changed = new Set<DocName>()
        for (const [k, delta] of msg.deltas) {
          const [start, end] = database.mergeEntryDiff(db, k, delta)
          let entry = db.entries.get(k)!

          // Presumably the remote peer has just sent us all the data it has that we were
          // missing. I could call intersectWithSummary2 here, but this should be
          // sufficient.
          const uv = unknownVersions?.get(k)
          if (uv != null) {
            // We must have recieved all unknown versions from this peer.
            const [_ignored, remainder] = causalGraph.intersectWithSummary(entry.cg, uv, entry.cg.heads)
            if (remainder != null) throw Error("We're still missing versions from remote peer. Bad problem. Fix plz.")
            unknownVersions!.delete(k)
          }

          if (end !== start) {
            // We have new local changes we didn't know about before.
            changed.add(k)

            // We need to add this document to the overlay set to prevent ourselves
            // from broadcasting these changes back to the peer we've just recieved
            // them from

            // There's 2 implementation choices here:
            // 1. The versionOverlay variable could just store the new heads we've
            //    recieved from the remote peer
            // 2. The versionOverlay stores the remote heads merged with our local
            //    changes.
            // Doing 2 for now, but on a whim.

            // Defaulting to oldHead here because the new version might not dominate
            // the current version we have locally.
            let overlayHeads = state.versionOverlay.get(k) ?? ctx.globalKnownVersions.get(k) ?? []
            overlayHeads = causalGraph.advanceVersionFromSerialized(entry.cg, delta.cg, overlayHeads)
            // Is this really needed?? TODO
            overlayHeads = causalGraph.findDominators(entry.cg, overlayHeads)

            state.versionOverlay.set(k, overlayHeads)
          }
        }

        if (unknownVersions != null && unknownVersions.size != 0) {
          throw Error('Peer did not send all of the versions we need in the first packet. What')
        }

        if (changed.size > 0) {
          // emit(ctx.listeners, 'remote', changed)
          emitDocsChanged(ctx, 'remote', changed)
        }

        break
      }

      // default:
      //   console.warn('Unrecognised network message', msg)
    }
  })

  finished(sock, (err) => {
    console.log('Socket closed', sock.remoteAddress, sock.remotePort)
    ctx.listeners.delete(onVersionChanged)
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

const serverOnPort = (port: number, ctx: RuntimeContext) => {
  const server = net.createServer(async sock => {
    console.log('got server socket connection', sock.remoteAddress, sock.remotePort)
    runProtocol(sock, ctx)
  })

  server.listen(port, () => {
    console.log(`Server listening on port ${port}`)
  })
}

const connect1 = (host: string, port: number, ctx: RuntimeContext) => {
  const sock = net.connect({port, host}, () => {
    console.log('connected!')
    runProtocol(sock, ctx)
  })
}


const connect = (host: string, port: number, ctx: RuntimeContext) => {
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
        await runProtocol(socket, ctx)
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
  const [db, save] = database.createOrLoadDb() // TODO: Use path from command line

  const globalKnownVersions = new Map<DocName, LV[]>()
  for (const [name, entry] of db.entries) {
    // Initialized with the current version of all entries.
    globalKnownVersions.set(name, entry.cg.heads.slice())
  }

  const ctx: RuntimeContext = {
    db,
    globalKnownVersions,
    listeners: new Set([save]),
  }

  for (let i = 2; i < process.argv.length; i++) {
    const command = process.argv[i]
    switch (command) {
      case '-l': {
        const port = +process.argv[++i]
        if (port === 0 || isNaN(port)) throw Error('Invalid port (usage -l <PORT>)')

        serverOnPort(port, ctx)
        break
      }

      case '-c': {
        const host = process.argv[++i]
        if (host == null) throw Error('Missing host to connect to! (usage -c <HOST> <PORT>')
        const port = +process.argv[++i]
        if (port === 0 || isNaN(port)) throw Error('Invalid port (usage -c <HOST> <PORT>)')

        connect(host, port, ctx)
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

  startRepl(ctx)
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