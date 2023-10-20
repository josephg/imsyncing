// This file should only be pulled in from nodejs.
import * as sb from 'schemaboi'
import {localDbSchema} from './schema.js'
import * as fs from 'node:fs'
import { createDb } from './db.js'
import { rateLimit } from './utils.js'
import { Db, DbChangeListener } from './types.js'


const saveNow = (filename: string, schema: sb.Schema, db: Db) => {
  const data = sb.write(schema, db)
  console.log(`saving ${data.byteLength} bytes`)

  // console.log('data', data)
  fs.writeFileSync(filename, data)
  console.log('Db saved to', filename)
}

const createOrLoadInternal = (filename: string): [sb.Schema, Db] => {
  try {
    const rawData = fs.readFileSync(filename)
    const [mergedSchema, db] = sb.read(localDbSchema, rawData)
    return [mergedSchema, db as Db]
  } catch (e: any) {
    if (e.code == 'ENOENT') {
      console.warn(`Warning: Existing database does not exist. Creating new database at ${filename}`)
      const db = createDb()
      saveNow(filename, localDbSchema, db)
      return [localDbSchema, db]
    } else {
      console.error('Could not load previous database data')
      throw e
    }
  }
}

export function createOrLoadDb(filename: string): [Db, DbChangeListener] {
  const [schema, db] = createOrLoadInternal(filename)

  const save = rateLimit(1000, () => saveNow(filename, schema, db))

  process.on('exit', () => {
    // console.log('exit')
    save.doItNow()
  })

  console.log('agent', db.agent)

  return [db, save]
}

// Global singleton database for this process.
// export const [storageSchema, db] = load()


process.on('SIGTERM', () => {
  // save()
  process.exit()
})
process.on('SIGINT', () => {
  // save()
  process.exit()
})

process.on('uncaughtException', e => {
  console.error(e)
  process.exit(1)
})

process.on('unhandledRejection', e => {
  console.error(e)
  process.exit(1)
})

