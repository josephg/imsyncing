import { Schema, mergeSchemas, metaSchema, readRaw, writeLocalSchema, writeRawInto } from 'schemaboi'

export interface GenericSocket {
  framingBytes?: number,
  write(msg: Uint8Array, msgLen: number): void,
  data: AsyncIterableIterator<Uint8Array>,
  whenFinished: Promise<void>,
  readable: boolean,
  writable: boolean,
  info(): string,
  close(): void,
}

const concatBuffers = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const result = new Uint8Array(a.length + b.length)
  result.set(a, 0)
  result.set(b, a.length)
  return result
}

// export type MsgHandler<Msg = any> = (msg: Msg, sock: Socket) => void
export type MsgHandler<Msg = any> = (msg: Msg) => void

export async function *framing(stream: AsyncIterableIterator<Uint8Array>) {
  let buffer = new Uint8Array(0) // New, empty array.

  for await (const newData of stream) {
    // If the socket is closed, the iterator should stop.

    // This is a bit inefficient, but eh.
    buffer = concatBuffers(buffer, newData)

    while (true) {
      // Try to read the next message from buffer.

      if (buffer.byteLength < 4) break
      const msgLength = (new DataView(buffer.buffer, buffer.byteOffset)).getUint32(0, false)
      // const msgLength = buffer.readUInt32BE(0)
      let offset = 4 // We've read the message length.

      if (buffer.byteLength < offset + msgLength) break // Need more bytes then we'll try again.
      const rawMsg = buffer.subarray(offset, offset + msgLength)

      yield rawMsg

      offset += msgLength

      // This just does a shallow copy, but since concat will reallocate the buffer, that should be ok.
      // Its still not the greatest in terms of copies, but eh.
      buffer = buffer.subarray(offset)
    }
  }
}

/**
 * This function encodes & decodes the binary messages in the socket via schemaboi.
 *
 * TODO: The complexity here probably isn't warranted. It might better to just
 * return a generator (async function*) of all the messages.
 */
export function handleSBProtocol<Msg>(sock: GenericSocket, localSchema: Schema, onMsg: MsgHandler<Msg>) {
  let closed = false

  // This method handles a protocol that works as follows:
  // - Each message sent over the wire is length-prefixed by a Uint32BE length value. (4gb should be
  //   enough for anyone).
  // - The remaining message is encoded using schemaboi.
  // - On connect, the system immediately sends a message containing the local schema. This is always
  //   the first message.

  let mergedSchema: null | Schema = null

  if (sock.readable) {
    ;(async () => {
      for await (const rawMsg of await sock.data) {
        if (mergedSchema == null) {
          // Read the schema out.
          const remoteSchema: Schema = readRaw(metaSchema, rawMsg)
          mergedSchema = mergeSchemas(remoteSchema, localSchema)
          // console.log('merged schemas')
        } else {
          const msg = readRaw(mergedSchema, rawMsg)
          onMsg(msg)
        }

        // To allow the onMsg handler to close the reader.
        if (closed) return
      }
    })()
  }

  const writeMsg = (schema: Schema, msg: any) => {
    if (sock.writable) {
      const framingBytes = sock.framingBytes ?? 0
      const msgRaw = writeRawInto(schema, msg, new Uint8Array(32), framingBytes)
      let msgLen = msgRaw.byteLength - framingBytes // Length not including message header.
      sock.write(msgRaw, msgLen)
    }
  }

  // Send the schema - which is just the localschema encoded using the metaschema.
  // TODO: Prefix this with the metaschema version / magic or something.
  writeMsg(metaSchema, localSchema)

  sock.whenFinished.finally(() => closed = true)

  return {
    write(msg: Msg) {
      writeMsg(localSchema, msg)
    },
    close() {
      closed = true
      sock.close()
    }
  }
}