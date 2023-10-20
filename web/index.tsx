// // import {runProtocol} from '../dist/src/protocol.js'

// console.log('oh hai')

// console.log(runProtocol)

import './index.css'
import styles from './test.module.css'
import {autoReconnect, runProtocol} from '../src/protocol.js'

import { render } from 'solid-js/web';
import { createDb } from '../src/db.js';
import { createCtx } from '../src/runtimectx.js';
import { GenericSocket } from '../src/message-stream.js';
import {createIterableStream} from 'ministreamiterator'
import { resolvable } from '../src/utils.js';
import { For, createSignal } from 'solid-js';
import { toJS } from '../src/db-entry.js';

// import './index.css';
// import App from './App';

const [docList, setDocList] = createSignal<{key: string, data: any}[]>([])
function App() {
  return (<>
      <h1 class={styles.App}>Hiii</h1>
      <ul>
        <For each={docList()}>{(doc, i) =>
          <li>
            {doc.key} {JSON.stringify(doc.data)}
          </li>
        }</For>
      </ul>
    </>
  );
}


// const root = document.getElementById('body');
render(() => <App />, document.body);


const ctx = createCtx()

ctx.listeners.add((from, changed) => {
  console.log(from, changed)
  // return [...db.entries.entries()].map(([k, e]) => ([k, toJS(e)]))

  setDocList(
    [...ctx.db.entries.entries()]
      .map(([k, e]) => ({key: k, data: toJS(e)}))
  )
})

{
  const loc = window.location
  const wsUrl = (loc.protocol === 'https:' ? 'wss://' : 'ws://')
    + loc.host + '/'

  autoReconnect(ctx, async () => {
    const sock = resolvable<GenericSocket>()

    const ws = new WebSocket(wsUrl)
    ws.binaryType = 'arraybuffer'

    // These get overwritten in the onopen handler below.
    ws.onclose = () => { sock.reject(Error('websocket closed before it opened')) }
    ws.onerror = (err) => { sock.reject(err) }

    ws.onopen = () => {
      console.log('ws open!')

      const readStream = createIterableStream<Uint8Array>(() => {})

      ws.onmessage = msg => {
        if (msg.data instanceof ArrayBuffer) {
          readStream.append(new Uint8Array(msg.data))
        } else {
          console.warn('Got text message over websocket. Ignoring!')
        }
        console.log('msg type', msg.type)
      }

      const whenFinished = resolvable()
      ws.onclose = () => { whenFinished.resolve() }
      ws.onerror = (err) => { whenFinished.reject(err) }

      sock.resolve({
        write(msg) {
          console.log('sending ws message of length', msg.byteLength)
          ws.send(msg)
        },
        data: readStream.iter,
        close() { ws.close() },
        info() { return wsUrl },
        readable: true,
        writable: true,
        whenFinished: whenFinished.promise,
      })
    }

    return sock.promise
  })


}

// autoReconnect(ctx, () => {

// })
// runProtocol(


