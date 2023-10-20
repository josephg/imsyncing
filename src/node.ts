// nodejs only.

import { LV, DocName, RuntimeContext } from "./types.js"
import { resolvable } from "./utils.js"
import { GenericSocket } from "./message-stream.js"
import startRepl from './repl.js'
import { autoReconnect, runProtocol } from "./protocol.js"

import * as net from 'node:net'
// import { finished } from "node:stream"
import stream from "node:stream"
import { Socket } from 'node:net'

import {Console} from 'node:console'
import { createOrLoadDb } from "./storage.js"
const console = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: {depth: null}
})
Error.stackTraceLimit = Infinity

const wrapNodeSocket = (sock: Socket): GenericSocket => {
  return {
    write(msg) {
      if (sock.writable) sock.write(msg)
    },
    data: sock[Symbol.asyncIterator](),
    whenFinished: stream.promises.finished(sock),
    readable: sock.readable,
    writable: sock.writable,
    info() {
      return `${sock.remoteAddress}:${sock.remotePort}`
    },
    close() {
      this.readable = this.writable = false
      sock.end()
      sock.destroy()
    },
  }
}

const serverOnPort = (port: number, ctx: RuntimeContext) => {
  const server = net.createServer(async sock => {
    console.log('got server socket connection', sock.remoteAddress, sock.remotePort)
    runProtocol(wrapNodeSocket(sock), ctx)
  })

  server.listen(port, () => {
    console.log(`Server listening on port ${port}`)
  })
}

const connect1 = (host: string, port: number, ctx: RuntimeContext) => {
  const sock = net.connect({port, host}, () => {
    console.log('connected!')
    runProtocol(wrapNodeSocket(sock), ctx)
  })
}

const connect = (host: string, port: number, ctx: RuntimeContext) => {
  autoReconnect(ctx, async () => {
    console.log('Connecting to', host, port, '...')
    const socket = new net.Socket()
    const connectPromise = resolvable<GenericSocket>()
    socket.once('error', connectPromise.reject)
    socket.once('connect', () => {
      socket.removeListener('error', connectPromise.reject)
      connectPromise.resolve(wrapNodeSocket(socket))
    })
    socket.connect({port, host})
    return connectPromise.promise
  })
}


// ***** Command line argument passing
{
  const [db, save] = createOrLoadDb(process.env['DB_FILE'] ?? 'db.scb') // TODO: Use path from command line

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
