import { CRACK_STATUSES, parseWidthMm } from './crack'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：业务记录与扩展存储桶都放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'geohazard-patrol:entries'
const BUCKET_PREFIX = 'geohazard-patrol:bucket:'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

type StoreShape = Record<string, EntryRow[]>

function dedupeCrackRows(rows: EntryRow[]): EntryRow[] {
  // 同一裂缝编号只保留一条：重复封填曾留下一模一样的残留行，这里统一清掉。
  // 保留最早登记（id 最小）的一条；状态取推进最远的，避免封填结果丢失。
  const picked = new Map<string, EntryRow>()
  for (const row of rows) {
    const code = String(row['裂缝编号'] ?? '').trim()
    if (!code) {
      const fallback = String(row.id)
      const prev = picked.get(fallback)
      if (!prev) picked.set(fallback, row)
      continue
    }
    const prev = picked.get(code)
    if (!prev) {
      picked.set(code, row)
      continue
    }
    const prevStage = CRACK_STATUSES.indexOf(String(prev.status) as (typeof CRACK_STATUSES)[number])
    const stage = CRACK_STATUSES.indexOf(String(row.status) as (typeof CRACK_STATUSES)[number])
    const winner = stage > prevStage ? row : prev
    picked.set(code, winner)
  }
  return [...picked.values()]
}

function sanitizeCrackRows(rows: EntryRow[]): EntryRow[] {
  // 历史数据里本期宽度/累计变宽可能落成了无效文本，统一清洗成数值；
  // 解析不出来的不臆造数值，回退为 0 并保留可再次填报的状态语义。
  return rows.map((row) => {
    const width = parseWidthMm(row['本期宽度'])
    const total = parseWidthMm(row['累计变宽'])
    const next: EntryRow = { ...row }
    if (width !== null) {
      next['本期宽度'] = width
    }
    next['累计变宽'] = total ?? 0
    return next
  })
}

function migrate(data: StoreShape): StoreShape {
  if (!Array.isArray(data.crack)) {
    return data
  }
  return { ...data, crack: sanitizeCrackRows(dedupeCrackRows(data.crack)) }
}

function readStorage(): StoreShape {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return migrate(fallback)
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seeded = migrate(fallback)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
  try {
    const parsed = JSON.parse(raw) as StoreShape
    // 旧版本可能缺模块，用种子补齐；同时跑一遍裂缝去重/清洗，清掉历史残留。
    return migrate({ ...fallback, ...parsed })
  } catch {
    const seeded = migrate(fallback)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
}

let cache: StoreShape | null = null

export function allRows(): StoreShape {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: key === 'crack' ? dedupeCrackRows(rows) : rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

/** 新增登记时取下一个自增编号，沿用各模块现有的数字主键。 */
export function nextRowId(key: string): number {
  return listRows(key).reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

/** 扩展存储桶：治理待办等附属数据不挤进业务清单，单独存取。 */
export function listBucket<T>(name: string): T[] {
  const fallback = (bucketCache.get(name) ?? []) as T[]
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(BUCKET_PREFIX + name)
  if (!raw) {
    return fallback
  }
  try {
    const value = JSON.parse(raw) as T[]
    bucketCache.set(name, value as unknown[])
    return Array.isArray(value) ? value : []
  } catch {
    return fallback
  }
}

export function saveBucket<T>(name: string, rows: T[]): void {
  bucketCache.set(name, rows as unknown[])
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(BUCKET_PREFIX + name, JSON.stringify(rows))
  }
}

const bucketCache = new Map<string, unknown[]>()
