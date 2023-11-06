// I want to reuse agent IDs in the browser, to do what we
// can to guard against an agent explosion over time.
//
// I'd like to just use localstorage for this, but there's a
// race condition when taking an agent - since 2 tabs could take
// the same agent. So IndexedDb it is.
//
// Unfortunately IndexedDb has a very verbose API. Eh.

import { createRandomId } from "../src/utils.js"


const DB_NAME = 'agents'
const STORE_NAME = 'agentStore'

const toPromise = <T>(req: IDBRequest<T>): Promise<T> => (
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
)

let dbPromise: Promise<IDBDatabase>
let db: IDBDatabase | null = null

// Open the database.
{
  const req: IDBOpenDBRequest = indexedDB.open(DB_NAME, 1)

  req.onupgradeneeded = (event: IDBVersionChangeEvent) => {
    console.log('onupgradeneeded')
    const db: IDBDatabase = (event.target as IDBOpenDBRequest).result
    db.createObjectStore(STORE_NAME, { autoIncrement: true })
  }

  dbPromise = toPromise(req)
  dbPromise.catch(console.error)
  dbPromise.then(_db => db = _db)
}

export async function getAgentFromIDB(): Promise<string> {
  const db = await dbPromise

  const transaction: IDBTransaction = db.transaction(STORE_NAME, 'readwrite')
  const objectStore: IDBObjectStore = transaction.objectStore(STORE_NAME)
  const cursor = await toPromise(objectStore.openKeyCursor(IDBKeyRange.lowerBound(1), 'prev'))

  // Nothing in the database. Make a random ID.
  if (cursor == null) {
    console.log('No cursor returned')
    return createRandomId()
  }

  // if (agentKey == null) return [createRandomId(), null]

  // Otherwise we'll fetch & delete the key we found.
  const agentKey = cursor.key
  let agent: string = await toPromise(objectStore.get(agentKey))
  objectStore.delete(agentKey)

  console.log('got key', agentKey, 'agent', agent)
  return agent
  // return [agent, agentKey]
}

export function storeAgent(agent: string) {
  // This API is asyncronous and we really want it to happen when tabs close, which
  // isn't guaranteed. But it seems reliable enough.
  //
  // Worst case, we end up generating a new agent ID. Eh.
  if (db != null) {
    const transaction: IDBTransaction = db.transaction(STORE_NAME, 'readwrite')
    const objectStore: IDBObjectStore = transaction.objectStore(STORE_NAME)
    objectStore.add(agent)
    transaction.commit() // hopefully this happens in time!
  }
}
