// Helper functions for the runtime context.

import { DbEntryDiff, serializePartialSince } from "./db-entry.js"
import { Db, DocName, LV, RuntimeContext } from "./types.js"
import { emit } from "./utils.js"
import * as causalGraph from 'causal-graph'
import { createDb } from "./db.js"

// export function emitChangeEvent(ctx: RuntimeContext, from: 'local' | 'remote', changed: Set<[docName: DocName, oldHeads: LV[]]>) {
export function emitDocsChanged(ctx: RuntimeContext, from: 'local' | 'remote', changed: Set<DocName>) {
  const deltasToSend = new Map<DocName, DbEntryDiff>()
  for (const docName of changed) {
    const entry = ctx.db.entries.get(docName)!

    const sendFrom = ctx.globalKnownVersions.get(docName) ?? []

    if (sendFrom.length === 0 || !causalGraph.lvEq(sendFrom, entry.cg.heads)) {
      deltasToSend.set(docName, serializePartialSince(entry, sendFrom))
    }

    ctx.globalKnownVersions.set(docName, entry.cg.heads.slice())
  }

  emit(ctx.listeners, from, changed, deltasToSend)
}

// export function emitChangeEvent1(ctx: RuntimeContext, from: 'local' | 'remote', doc: DocName, oldHead: LV[]) {
export function emit1DocChanged(ctx: RuntimeContext, from: 'local' | 'remote', doc: DocName) {
  // emit(ctx.listeners, from, new Set([doc]))

  // emitChangeEvent(ctx, from, new Set([[doc, oldHead]]))
  emitDocsChanged(ctx, from, new Set([doc]))
}

export function createCtx(db: Db = createDb()): RuntimeContext {
  const globalKnownVersions = new Map<DocName, LV[]>()
  for (const [name, entry] of db.entries) {
    // Initialized with the current version of all entries.
    globalKnownVersions.set(name, entry.cg.heads.slice())
  }

  return {
    db,
    globalKnownVersions,
    listeners: new Set(),
  }
}
