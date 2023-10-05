import * as causalGraph from "./causal-graph.js";
import { Op, AtLeast1, LV, NetMsg, Primitive, RawOperation, RawVersion, VersionSummary } from "./types.js";
import { AgentVersion, createAgent, min2, nextVersion, resolvable, wait } from "./utils.js";
import * as sb from 'schemaboi'
import * as database from './db.js'
import * as net from 'node:net'

import {Console} from 'node:console'
import { localNetSchema } from "./schema.js";
import handle from "./message-stream.js";
import { finished } from "node:stream";
import startRepl from './repl.js'


const console = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: {depth: null}
})

// let cg = CG.create()



// let agent = createAgent()

const mergeFrom = (into: database.Db, from: database.Db) => {
  // let fromHeads = cg.lvToRawList(from.cg, from.cg.heads)
  let vs = causalGraph.summarizeVersion(into.cg)

  const [common, remainder] = causalGraph.intersectWithSummary(from.cg, vs)
  console.log('common', common, 'rem', remainder)

  // The remainder gives us a bunch of ranges of versions to send, and common
  // is the most recent common LV.

  const cgDiff = causalGraph.serializeFromVersion(from.cg, common)
  console.log('sd', cgDiff)


  // And we need to grab & merge all the deltas.
  const opsToSend = database.getOpsInDiff(from, cgDiff)
  console.log('ops', opsToSend)

  let opIdx = 0
  // Ok now merge everything. Merge the CG changes...
  // let [start, end] = cg.mergePartialVersions(into.cg, cgDiff)
  database.mergeDelta(into, cgDiff, opsToSend)
}

// console.log('agent', db.db.agent)

// const dbListeners = new Set<() => void>()

// db.events.on('change', (from: 'remote' | 'local') => {
//   // console.log('change', from, dbListeners.size)
//   for (const l of dbListeners) {
//     l()
//   }
// })

const runProtocol = (sock: net.Socket, db: database.Db): Promise<void> => {
  type ProtocolState = {state: 'waitingForVersion'} | {
    state: 'established',
    /**
     * The version that we expect the remote peer to have.
     * This includes sent versions that haven't been acknowledged yet.
     *
     * It is always <= our current version.
     *
     * The remoteVersion on all connected peers will generally move in lockstep.
     * We still have this value here because if we're connected to 2 peers, we
     * update remoteVersion when we get deltas from one peer and that way we know
     * not to reflect the changes back to that peer.
     */
    remoteVersion: LV[],

    /** Versions the remote peer has that we don't have yet. */
    unknownVersions: VersionSummary | null
  }

  let state: ProtocolState = {state: 'waitingForVersion'}

  // type ProtocolState = {state: 'waitingForVersion'}
  //   | {
  //     state: 'established',
  //     remoteVersion: LV[],
  //     unknownVersions: VersionSummary | null
  //   }

  // let state: ProtocolState = {state: 'waitingForVersion'}

  const finishPromise = resolvable()


  const sendDelta = (sinceVersion: LV[]) => {
    console.log('sending delta to', sock.remoteAddress, sock.remotePort, 'since', sinceVersion)
    const cgDiff = causalGraph.serializeFromVersion(db.cg, sinceVersion)
    const opsToSend = database.getOpsInDiff(db, cgDiff)
    write({
      type: 'Delta',
      cg: cgDiff,
      ops: opsToSend
    })
  }

  const onVersionChanged = () => {
    console.log('onVersionChanged', state)
    if (state.state !== 'established') throw Error('Unexpected connection state')
    const cg = db.cg

    if (state.unknownVersions != null) {
      // The db might now include part of the remainder. Doing this works
      // around a bug where connecting to 2 computers will result in
      // re-sending known changes back to them.
      // console.log('unknown', state.unknownVersions)
      ;[state.remoteVersion, state.unknownVersions] = causalGraph.intersectWithSummary(
        cg, state.unknownVersions, state.remoteVersion
      )
      // console.log('->known', state.unknownVersions)
    }

    // console.log('cg heads', cg.heads)
    if (!causalGraph.lvEq(state.remoteVersion, cg.heads)) {
      console.log('state version', state.remoteVersion, 'cg heads', cg.heads)
      sendDelta(state.remoteVersion)
      // The version will always (& only) advance forward.
      state.remoteVersion = cg.heads.slice()
    }
  }


  const {close, write} = handle<NetMsg>(sock, localNetSchema, (msg, sock) => {
    console.log('got net msg', msg)
    const cg = db.cg

    switch (msg.type) {
      case 'Hello': {
        if (state.state !== 'waitingForVersion') throw Error('Unexpected connection state')

        // When we get the known versions, we always send a delta so the remote
        // knows they're up to date (even if they were already anyway).
        const summary = msg.versionSummary
        const [sinceVersion, remainder] = causalGraph.intersectWithSummary(cg, summary)
        // console.log('known idx version', sinceVersion)
        if (!causalGraph.lvEq(sinceVersion, cg.heads)) {
          // We could always send the delta here to let the remote peer know they're
          // up to date, but they can figure that out by looking at the known idx version
          // we send on first connect.

          console.log('send delta', sinceVersion)
          // sendDelta(sv)

          sendDelta(sinceVersion)
        }

        state = {
          state: 'established',
          remoteVersion: cg.heads.slice(),
          // remoteVersion: sinceVersion,
          unknownVersions: remainder
        }

        db.listeners.add(onVersionChanged)
        break
      }

      case 'Delta': {
        if (state.state !== 'established') throw Error('Invalid state')

        // console.log('got delta', msg.cg, msg.ops)

        // Importantly, the notify event will fire after other syncronous stuff we do here.
        database.mergeDelta(db, msg.cg, msg.ops)

        state.remoteVersion = causalGraph.advanceVersionFromSerialized(
          cg, msg.cg, state.remoteVersion
        )
        // TODO: Ideally, this shouldn't be necessary! But it is because the remoteVersion
        // also gets updated as a result of versions *we* send.
        state.remoteVersion = causalGraph.findDominators(cg, state.remoteVersion)
        console.log('new state version', state.remoteVersion)

        // Presumably the remote peer has just sent us all the data it has that we were
        // missing. I could call intersectWithSummary2 here, but this should be
        // sufficient.
        state.unknownVersions = null
        
        database.emitChangeEvent(db, 'local')
        break
      }
    }
  })

  finished(sock, (err) => {
    console.log('Socket closed', sock.remoteAddress, sock.remotePort)
    db.listeners.delete(onVersionChanged)
    close()

    if (err) finishPromise.reject(err)
    else finishPromise.resolve()
  })

  write({type: 'Hello', versionSummary: causalGraph.summarizeVersion(db.cg)})

  return finishPromise.promise
}

const serverOnPort = (port: number, db: database.Db) => {
  const server = net.createServer(async sock => {
    console.log('got server socket connection', sock.remoteAddress, sock.remotePort)
    runProtocol(sock, db)
    // handler.write({oh: 'hai'})
  })

  server.listen(port, () => {
    console.log(`Server listening on port ${port}`)
  })
}

const connect1 = (host: string, port: number, db: database.Db) => {
  const sock = net.connect({port, host}, () => {
    console.log('connected!')
    runProtocol(sock, db)
  })
}


const connect = (host: string, port: number, db: database.Db) => {
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