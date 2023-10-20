// nodejs only.

import { LV, DocName, RuntimeContext } from "./types.js"
import { resolvable } from "./utils.js"
import { GenericSocket, framing } from "./message-stream.js"
import startRepl from './repl.js'
import { autoReconnect, runProtocol } from "./protocol.js"
import { WebSocketServer } from 'ws'
import {createIterableStream} from 'ministreamiterator'

import * as net from 'node:net'
// import { finished } from "node:stream"
import stream from "node:stream"
import { Socket } from 'node:net'

import {Console} from 'node:console'
import http from 'node:http'
import { createOrLoadDb } from "./storage.js"
import { createCtx } from "./runtimectx.js"
import polka from "polka"
import sirv from "sirv"

const console = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: {depth: null}
})
Error.stackTraceLimit = Infinity

const wrapNodeSocket = (sock: Socket): GenericSocket => {
  if (!sock.readable) throw Error('Cannot wrap unreadable socket')

  return {
    // For raw node sockets, we prepend a 4 byte packet length at the start
    // of each message. This is stripped off by the framing() method.
    framingBytes: 4,
    write(msg, msgLen) {
      if (sock.writable) {
        ;(new DataView(msg.buffer, msg.byteOffset)).setUint32(0, msgLen, false)
        sock.write(msg)
      }
    },
    data: framing(sock[Symbol.asyncIterator]()),

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

const netServer = (port: number, ctx: RuntimeContext) => {
  const server = net.createServer(async sock => {
    console.log('got server socket connection', sock.remoteAddress, sock.remotePort)
    runProtocol(wrapNodeSocket(sock), ctx)
  })

  server.listen(port, () => {
    console.log(`Server listening on port ${port}`)
  })
}

const wsServer = (port: number, ctx: RuntimeContext) => {
  const app = polka()
  app.use(sirv('public', {dev: true}))
  const server = http.createServer(app.handler as any)
  const wss = new WebSocketServer({ server })

  wss.on('connection', (ws, req) => {
      console.log('got server socket connection', req.socket.remoteAddress, req.socket.remotePort)
    if (ws.readyState !== ws.OPEN) throw Error('ws not ready')

    const readStream = createIterableStream<Uint8Array>(() => {})
    ws.on('message', (msg) => {
      if (Buffer.isBuffer(msg)) {
        const data = new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength)
        readStream.append(data)
      } else if (msg instanceof ArrayBuffer) {
        readStream.append(new Uint8Array(msg))
      } else {
        // I don't know why, but the types say msg could also be an array of
        // node buffers (???). Does this ever happen? Who knows. I'll handle it.
        for (const m of msg) {
          const data = new Uint8Array(m.buffer, m.byteOffset, m.byteLength)
          readStream.append(data)
        }
      }
    })

    const whenFinished = resolvable()

    const sock: GenericSocket = {
      write(msg) { ws.send(msg) },
      data: readStream.iter,
      close() { ws.close() },
      info() { return `${req.socket.remoteAddress} ${req.socket.remotePort}` },
      readable: ws.readyState === ws.OPEN,
      writable: ws.readyState === ws.OPEN,
      whenFinished: whenFinished.promise,
    }

    ws.onopen = () => { sock.readable = true }
    ws.onclose = () => { whenFinished.resolve() }
    ws.onerror = (err) => { whenFinished.reject(err) }

    runProtocol(sock, ctx)
  })

  server.listen(port, () => {
    console.log(`WS server listening on port ${port}`)
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
  const ctx = createCtx(db)
  ctx.listeners.add(save)

  for (let i = 2; i < process.argv.length; i++) {
    const command = process.argv[i]
    switch (command) {
      case '-l': {
        const port = +process.argv[++i]
        if (port === 0 || isNaN(port)) throw Error('Invalid port (usage -l <PORT>)')

        netServer(port, ctx)
        break
      }

      case '-w': {
        const port = +process.argv[++i]
        if (port === 0 || isNaN(port)) throw Error('Invalid port (usage -w <PORT>)')

        wsServer(port, ctx)
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
