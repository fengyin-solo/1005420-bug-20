import {
  CRACK_TRENDS,
  CRACK_TRANSITIONS,
  accumulateWidth,
  parseWidthMm,
} from '@/data/crack'
import {
  appendGovernanceTodo,
  listGovernanceTodos,
  resolveGovernanceTodo,
} from '@/data/governance-todos'
import { MODULE_BY_KEY } from '@/data/modules'
import { listRows, nextRowId, resetRows, saveRows, allRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export type ActionPayload = {
  [field: string]: unknown
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

/** 详情抽屉与各入口共用的唯一读取口径，按 id 取同一条记录。 */
export function getEntry(key: string, id: number): EntryRow | null {
  return listRows(key).find((row) => Number(row.id) === Number(id)) ?? null
}

function fail(message: string): ActionResult {
  return { ok: false, message }
}

function received(message: string): ActionResult {
  // 重复提交不二次落库，按第一次已收处理：返回 ok，页面照常刷新即可。
  return { ok: true, message }
}

// ---------------------------------------------------------------------------
// 裂缝领域
// ---------------------------------------------------------------------------

export type CrackCreateInput = {
  裂缝编号: string
  所属隐患点: string
  裂缝走向: string
  观测日期: string
  观测人: string
  本期宽度?: unknown
}

/** 登记一条裂缝观测记录。编号唯一、走向取统一字典；宽度填了就必须合法。 */
export function createCrack(input: CrackCreateInput): ActionResult {
  const code = String(input.裂缝编号 ?? '').trim()
  if (!code) {
    return fail('裂缝编号不能为空，请补充后重填')
  }
  const hazard = String(input.所属隐患点 ?? '').trim()
  if (!hazard) {
    return fail('所属隐患点不能为空，请补充后重填')
  }
  if (!CRACK_TRENDS.includes(input.裂缝走向 as (typeof CRACK_TRENDS)[number])) {
    return fail('裂缝走向必须从统一字典中选择，不能自行填写')
  }
  const date = String(input.观测日期 ?? '').trim()
  if (!date) {
    return fail('观测日期不能为空，请补充后重填')
  }
  const observer = String(input.观测人 ?? '').trim()
  if (!observer) {
    return fail('观测人不能为空，请补充后重填')
  }
  let width: number | null = null
  const rawWidth = input.本期宽度
  if (String(rawWidth ?? '').trim() !== '') {
    width = parseWidthMm(rawWidth)
    if (width === null) {
      // 本期宽度落成无效值，一律退回重填，不允许带着脏数据入库。
      return fail('本期宽度不是有效的非负毫米数值，请按毫米重填（如 12.5）')
    }
  }
  const rows = listRows('crack')
  if (rows.some((row) => String(row['裂缝编号'] ?? '') === code)) {
    return fail(`裂缝编号 ${code} 已存在，不能重复登记`)
  }
  const row: EntryRow = {
    id: nextRowId('crack'),
    status: '待观测',
    pending: true,
    abnormal: false,
    裂缝编号: code,
    所属隐患点: hazard,
    裂缝走向: input.裂缝走向,
    本期宽度: width ?? '',
    累计变宽: 0,
    观测日期: date,
    观测人: observer,
    裂缝状态: '待观测',
  }
  saveRows('crack', [...rows, row])
  return { ok: true, message: `裂缝 ${code} 已登记，当前状态「待观测」` }
}

function runCrackAction(row: EntryRow, action: string, payload: ActionPayload): ActionResult {
  const rows = listRows('crack')
  const index = rows.findIndex((item) => Number(item.id) === Number(row.id))
  if (index < 0) {
    return fail(`没有找到编号为 ${row.id} 的裂缝观测记录`)
  }
  const current = rows[index]
  const status = String(current.status)

  if (action === '登记封填' && status === '已封填') {
    return received('该裂缝已按第一次封填落库，重复封填不再处理')
  }
  const allowed = CRACK_TRANSITIONS[action]
  if (!allowed) {
    return fail(`裂缝观测记录没有登记「${action}」这个动作`)
  }
  if (!allowed.includes(status as (typeof allowed)[number])) {
    return fail(`裂缝当前为「${status}」，不能执行「${action}」：状态只能 待观测→稳定→持续变宽→已封填 逐段推进，不能跳级`)
  }

  const next: EntryRow = { ...current }

  if (action === '提交观测') {
    const trend = String(payload.裂缝走向 ?? current['裂缝走向'] ?? '')
    if (!CRACK_TRENDS.includes(trend as (typeof CRACK_TRENDS)[number])) {
      return fail('裂缝走向必须从统一字典中选择')
    }
    const width = parseWidthMm(payload.本期宽度)
    if (width === null) {
      return fail('本期宽度不是有效的非负毫米数值，请按毫米重填（如 12.5）')
    }
    next.裂缝走向 = trend
    next.本期宽度 = width
    next.累计变宽 = 0
    next.观测日期 = String(payload.观测日期 ?? current['观测日期'] ?? '')
    next.观测人 = String(payload.观测人 ?? current['观测人'] ?? '')
    next.status = '稳定'
    next.pending = true
    next.裂缝状态 = '稳定'
  }

  if (action === '标记变宽') {
    const width = parseWidthMm(payload.本期宽度)
    if (width === null) {
      return fail('本期宽度不是有效的非负毫米数值，请按毫米重填（如 12.5）')
    }
    const baseline = parseWidthMm(current['本期宽度'])
    if (baseline === null) {
      return fail('上一期宽度缺失或无效，请先补录本期宽度')
    }
    // 本期宽度与裂缝走向打架时，以本期宽度实测值为第一依据：
    // 宽度未增大，即便走向为顺坡向也不得判为持续变宽。
    if (width <= baseline) {
      return fail(`本期宽度 ${width}mm 未大于上期 ${baseline}mm，按「宽度优先」口径不得标记变宽`)
    }
    next.本期宽度 = width
    next.累计变宽 = accumulateWidth(Number(current['累计变宽']) || 0, baseline, width)
    next.观测日期 = String(payload.观测日期 ?? current['观测日期'] ?? '')
    next.观测人 = String(payload.观测人 ?? current['观测人'] ?? '')
    next.status = '持续变宽'
    next.pending = true
    next.裂缝状态 = '持续变宽'
  }

  if (action === '登记封填') {
    // 封填一次落库：只改这一条，状态转已封填并自动退出持续变宽；累计变宽就此冻结。
    next.status = '已封填'
    next.pending = false
    next.abnormal = false
    next.裂缝状态 = '已封填'
  }

  const nextRows = [...rows]
  nextRows[index] = next
  saveRows('crack', nextRows)
  return { ok: true, message: `裂缝观测记录已${action}，当前状态「${next.status}」` }
}

// ---------------------------------------------------------------------------
// 隐患核销：复核结论驱动治理工程待办
// ---------------------------------------------------------------------------

export const CLEARANCE_CONCLUSIONS = ['已稳定核销', '需工程治理', '需继续监测'] as const

function runClearanceAction(row: EntryRow, action: string, payload: ActionPayload): ActionResult {
  const rows = listRows('clearance')
  const index = rows.findIndex((item) => Number(item.id) === Number(row.id))
  if (index < 0) {
    return fail(`没有找到编号为 ${row.id} 的核销单`)
  }
  const current = rows[index]
  const status = String(current.status)

  if (action === '提交复核') {
    if (status === '复核中') {
      return received('该核销单已按第一次提交进入复核，重复提交不再处理')
    }
    if (status !== '待复核') {
      return fail(`核销单当前为「${status}」，不能再提交复核`)
    }
    const next = { ...current, status: '复核中', pending: true }
    const nextRows = [...rows]
    nextRows[index] = next
    saveRows('clearance', nextRows)
    return { ok: true, message: '核销单已提交复核，当前状态「复核中」' }
  }

  if (action === '确认核销' || action === '驳回申请') {
    const target = action === '确认核销' ? '已核销' : '已驳回'
    // 重复复核按第一次已收处理：不再改状态、不再重复生成治理待办。
    if (status === '已核销' || status === '已驳回') {
      return received(`该核销单已按第一次复核结论「${status}」处理，重复复核不再落库`)
    }
    if (status !== '复核中') {
      return fail(`核销单当前为「${status}」，需先提交复核后才能${action}`)
    }

    const next: EntryRow = {
      ...current,
      status: target,
      pending: false,
      abnormal: action === '驳回申请',
    }

    if (action === '确认核销') {
      const conclusion = String(payload.核销结论 ?? '')
      if (!CLEARANCE_CONCLUSIONS.includes(conclusion as (typeof CLEARANCE_CONCLUSIONS)[number])) {
        return fail('请选择复核结论（已稳定核销 / 需工程治理 / 需继续监测）')
      }
      next.核销结论 = conclusion
      next.复核人 = String(payload.复核人 ?? current['复核人'] ?? '')
      next.复核日期 = String(payload.复核日期 ?? today())
      if (conclusion === '需工程治理') {
        // 复核结论驱动治理工程：同一核销单只生成一条待核项（幂等）。
        appendGovernanceTodo({
          核销编号: String(current['核销编号'] ?? ''),
          所属隐患点: String(current['所属隐患点'] ?? ''),
          复核结论: conclusion,
          待核内容: `依据复核结论核实 ${current['所属隐患点'] ?? ''} 的工程治理需求`,
          来源: '隐患核销复核',
          生成日期: today(),
        })
      }
    }

    const nextRows = [...rows]
    nextRows[index] = next
    saveRows('clearance', nextRows)
    return { ok: true, message: `核销单已${action}，当前状态「${target}」` }
  }

  return fail(`核销单没有登记「${action}」这个动作`)
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// 统一动作入口
// ---------------------------------------------------------------------------

export function runAction(
  key: string,
  id: number,
  action: string,
  payload: ActionPayload = {},
): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return fail(`${meta.entity}没有登记「${action}」这个动作`)
  }
  const row = listRows(key).find((item) => Number(item.id) === id)
  if (!row) {
    return fail(`没有找到编号为 ${id} 的${meta.entity}`)
  }

  if (key === 'crack') {
    return runCrackAction(row, action, payload)
  }
  if (key === 'clearance') {
    return runClearanceAction(row, action, payload)
  }

  const current = String(row.status)
  if (current === target) {
    return fail(`${meta.entity}已经是「${target}」，不用重复操作`)
  }
  const rows = listRows(key)
  const index = rows.findIndex((item) => Number(item.id) === id)
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== meta.statuses[meta.statuses.length - 1],
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

// 治理工程页直接复用的待核项接口。
export { listGovernanceTodos, resolveGovernanceTodo }

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const pendingTodos = listGovernanceTodos().filter((item) => item.状态 === '待核').length
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    {
      label: '待处理',
      value: modules.reduce((sum, item) => sum + item.pending, 0) + pendingTodos,
    },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
