import { RawVersion } from "./types.js"

export const min2 = (a: number, b: number) => a < b ? a : b
export const max2 = (a: number, b: number) => a > b ? a : b

export type AgentVersion = RawVersion
export const createRandomId = (): string => Math.random().toString(36).slice(2)
// export function createAgent(): AgentVersion {
//   const agent = Math.random().toString(36).slice(2)
//   return [agent, 0]
// }
export const nextVersion = (agent: AgentVersion): AgentVersion => {
  return [agent[0], agent[1]++]
}

// export function createAgent(): Agent {
//   const agent = Math.random().toString(36).slice(2)
//   let seq = 0
//   return () => ([agent, seq++])
// }

type RateLimit = {
  doItNow(): void,
  (): void,
}

export function rateLimit(min_delay: number, fn: () => void): RateLimit {
  let next_call = 0
  let timer: NodeJS.Timeout | null = null

  const rl = () => {
    let now = Date.now()

    if (next_call <= now) {
      // Just call the function.
      next_call = now + min_delay

      if (timer != null) {
        clearTimeout(timer)
        timer = null
      }
      fn()
    } else {
      // Queue the function call.
      if (timer == null) {
        timer = setTimeout(() => {
          timer = null
          next_call = Date.now() + min_delay
          fn()
        }, next_call - now)
      } // Otherwise its already queued.
    }
  }

  rl.doItNow = () => {
    if (timer != null) {
      clearTimeout(timer)
      timer = null
      fn()
    }
  }

  return rl
}

export const resolvable = <T = void>(): {promise: Promise<T>, resolve(val: T): void, reject(val: any): void} => {
  let resolve: any, reject: any
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return {promise, resolve, reject}
}

export const wait = (timeout: number) => new Promise((res) => setTimeout(res, timeout))

export const assertSortedCustom = <T>(v: T[], f: (t: T) => number) => {
  for (let i = 1; i < v.length; i++) {
    if (f(v[i-1]) >= f(v[i])) throw Error('Version not sorted')
  }
}

export const assertSorted = (v: number[]) => {
  for (let i = 1; i < v.length; i++) {
    if (v[i-1] >= v[i]) throw Error('Version not sorted')
  }
}

export const errExpr = (str: string): never => { throw Error(str) }