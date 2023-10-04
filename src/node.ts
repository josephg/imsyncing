import * as cg from "./causal-graph.js";
import { Action, AtLeast1, LV, NetMsg, Primitive, RawOperation, RawVersion } from "./types.js";
import { AgentVersion, createAgent, min2, nextVersion, resolvable, wait } from "./utils.js";
import * as sb from 'schemaboi'
import * as db from './db.js'
import * as net from 'node:net'

import {Console} from 'node:console'
import { localNetSchema } from "./schema.js";
import handle from "./message-stream.js";
import { finished } from "node:stream";
const console = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: {depth: null}
})

// let cg = CG.create()



// let agent = createAgent()

const mergeFrom = (into: db.Db, from: db.Db) => {
  // let fromHeads = cg.lvToRawList(from.cg, from.cg.heads)
  let vs = cg.summarizeVersion(into.cg)

  const [common, remainder] = cg.intersectWithSummary(from.cg, vs)
  console.log('common', common, 'rem', remainder)

  // The remainder gives us a bunch of ranges of versions to send, and common
  // is the most recent common LV.

  const cgDiff = cg.serializeFromVersion(from.cg, common)
  console.log('sd', cgDiff)


  // And we need to grab & merge all the deltas.
  const opsToSend = db.getOpsInDiff(from, cgDiff)
  console.log('ops', opsToSend)

  let opIdx = 0
  // Ok now merge everything. Merge the CG changes...
  // let [start, end] = cg.mergePartialVersions(into.cg, cgDiff)
  for (const [agent, seq, len, parents] of cgDiff) {
    let entry = cg.addRaw(into.cg, [agent, seq], len, parents)
    if (entry == null) {
      // We've already recieved these versions.
      opIdx += len
    } else {
      for (let i = 0; i < len; i++) {
        let op = opsToSend[opIdx++]
        into.ops.set(entry.version + i, op)
      }
      // And advance into's branch by the new entry.
      into.branch = cg.advanceFrontier(into.branch, entry.vEnd - 1, entry.parents)
    }
  }
}

console.log('agent', db.db.agent)


const runProtocol = (sock: net.Socket): Promise<void> => {
  // type ProtocolState = {state: 'waitingForVersion'}
  //   | {
  //     state: 'established',
  //     remoteVersion: LV[],
  //     unknownVersions: VersionSummary | null
  //   }

  // let state: ProtocolState = {state: 'waitingForVersion'}

  const finishPromise = resolvable()

  const {close, write} = handle<NetMsg>(sock, localNetSchema, (msg, sock) => {
    console.log('got net msg', msg)
  })

  finished(sock, (err) => {
    console.log('Socket closed', sock.remoteAddress, sock.remotePort)
    // dbListeners.delete(onVersionChanged)
    close()

    if (err) finishPromise.reject(err)
    else finishPromise.resolve()
  })

  write({type: 'Hello', versionSummary: cg.summarizeVersion(db.db.cg)})

  return finishPromise.promise
}

const serverOnPort = (port: number) => {
  const server = net.createServer(async sock => {
    console.log('got server socket connection', sock.remoteAddress, sock.remotePort)
    runProtocol(sock)
    // handler.write({oh: 'hai'})
  })

  server.listen(port, () => {
    console.log(`Server listening on port ${port}`)
  })
}

const connect1 = (host: string, port: number) => {
  const sock = net.connect({port, host}, () => {
    console.log('connected!')
    runProtocol(sock)
  })
}


const connect = (host: string, port: number) => {
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
        await runProtocol(socket)
      } catch (e: any) {
        console.warn('Could not connect:', e.message)
      }

      console.log('Reconnecting in 3 seconds...')
      await wait(3000)
    }
  })()
}


// ***** Command line argument passing
for (let i = 2; i < process.argv.length; i++) {
  const command = process.argv[i]
  switch (command) {
    case '-l': {
      const port = +process.argv[++i]
      if (port === 0 || isNaN(port)) throw Error('Invalid port (usage -l <PORT>)')

      serverOnPort(port)
      break
    }

    case '-c': {
      const host = process.argv[++i]
      if (host == null) throw Error('Missing host to connect to! (usage -c <HOST> <PORT>')
      const port = +process.argv[++i]
      if (port === 0 || isNaN(port)) throw Error('Invalid port (usage -c <HOST> <PORT>)')

      connect(host, port)
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