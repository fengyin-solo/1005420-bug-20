import { listBucket, saveBucket } from './local-store'
import type { EntryRow } from './types'

/**
 * 治理工程待核项：由隐患核销的复核结论（需工程治理）驱动生成，
 * 在治理工程页展示并可核办。放在独立存储桶里，不混进工程清单本身。
 */
export type GovernanceTodo = {
  id: number
  核销编号: string
  所属隐患点: string
  复核结论: string
  待核内容: string
  来源: string
  生成日期: string
  状态: '待核' | '已核办'
}

const BUCKET = 'governanceTodos'

export function listGovernanceTodos(): GovernanceTodo[] {
  return listBucket<GovernanceTodo>(BUCKET)
}

/**
 * 追加一条待核项。同一核销编号若已生成过（重复复核按第一次已收处理），
 * 不再新增，避免复核结论重复驱动出多条待办。
 */
export function appendGovernanceTodo(input: Omit<GovernanceTodo, 'id' | '状态'>): boolean {
  const todos = listGovernanceTodos()
  const existed = todos.some(
    (item) => item.核销编号 === input.核销编号 && item.状态 !== '已核办',
  )
  if (existed) {
    return false
  }
  const nextId = todos.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
  todos.push({ ...input, id: nextId, 状态: '待核' })
  saveBucket(BUCKET, todos)
  return true
}

export function resolveGovernanceTodo(id: number): boolean {
  const todos = listGovernanceTodos()
  const index = todos.findIndex((item) => Number(item.id) === id)
  if (index < 0) {
    return false
  }
  todos[index] = { ...todos[index], 状态: '已核办' }
  saveBucket(BUCKET, todos)
  return true
}

/** 治理工程页的待核项在运营概览里以 pending 行体现，这里给 loadOverview 复用。 */
export function governanceTodoRows(): EntryRow[] {
  return listGovernanceTodos().map((item) => ({
    id: item.id,
    status: item.状态,
    pending: item.状态 === '待核',
    abnormal: false,
    核销编号: item.核销编号,
    所属隐患点: item.所属隐患点,
    复核结论: item.复核结论,
    待核内容: item.待核内容,
    生成日期: item.生成日期,
  }))
}
