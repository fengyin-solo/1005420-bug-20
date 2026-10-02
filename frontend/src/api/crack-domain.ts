// 裂缝观测领域服务：裂缝的所有写入都只允许从这里走，页面组件不做业务判断。
// 集中解决：状态逐段推进不允许跳级、封填幂等且按裂缝编号去重、宽度无效值退回、
// 本期宽度与裂缝走向打架时的判定优先级、各入口读同一份（归一化后的）裂缝走向、
// 复核幂等（重复复核按第一次已收处理）且复核结论驱动治理工程的待核项。

import { allRows, listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, TodoRow } from '@/data/types'

export const CRACK_KEY = 'crack'
export const CRACK_STATUSES = ['待观测', '稳定', '持续变宽', '已封填'] as const

// 治理工程页里待办使用的伪模块键（不登记在 modules.ts，避免出现在导航与导出里）。
export const PROJECT_TODO_KEY = 'project-todos'
const TODO_SOURCE = '裂缝复核'
const TODO_TARGET = '治理工程'
const TODO_TITLE = '裂缝复核待核项'

const ID_FIELD = '裂缝编号'
const SITE_FIELD = '所属隐患点'
const TREND_FIELD = '裂缝走向'
const WIDTH_FIELD = '本期宽度'
const TOTAL_FIELD = '累计变宽'
const DATE_FIELD = '观测日期'
const OBSERVER_FIELD = '观测人'
const REVIEW_FIELD = '复核结论'
const REVIEWER_FIELD = '复核人'
const REVIEW_DATE_FIELD = '复核日期'

type CrackStatus = (typeof CRACK_STATUSES)[number]

// 允许的唯一推进路径：待观测 → 稳定 → 持续变宽 → 已封填，跳级一律拦下。
const NEXT_STATUS: Record<CrackStatus, CrackStatus | null> = {
  待观测: '稳定',
  稳定: '持续变宽',
  持续变宽: '已封填',
  已封填: null,
}

// 每个动作只接受它当前段的状态，其他状态一律视为跳级。
const ACTION_FROM: Record<string, CrackStatus> = {
  提交观测: '待观测',
  标记变宽: '稳定',
  登记封填: '持续变宽',
}

const REVIEW_REQUIRE_TREATMENT = '需工程治理'
const REVIEW_KEEP_WATCHING = '继续观测研判'
export const REVIEW_OPTIONS = [REVIEW_REQUIRE_TREATMENT, REVIEW_KEEP_WATCHING]

function fail(message: string): ActionResult {
  return { ok: false, message }
}

function ok(message: string): ActionResult {
  return { ok: true, message }
}

// 宽度解析：空值、非数字、负数、非有限数一律视为无效值，由调用方退回重填。
export function parseWidth(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null
  }
  const text = String(value ?? '').trim()
  if (text === '') {
    return null
  }
  const numeric = Number(text)
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null
  }
  return numeric
}

function formatWidth(value: number): string {
  return String(Math.round(value * 100) / 100)
}

// 裂缝走向归一化：各入口（登记/观测弹窗、详情抽屉、清单、筛选）展示的都是这一份写法，
// 不允许各说各话。统一成「方位（角度）」，例如 北东（45°）。
const TREND_ALIASES: Record<string, string> = {
  北: '北（0°）',
  南: '南（180°）',
  东: '东（90°）',
  西: '西（270°）',
  北东: '北东（45°）',
  东北: '北东（45°）',
  南东: '南东（135°）',
  东南: '南东（135°）',
  南西: '南西（225°）',
  西南: '南西（225°）',
  北西: '北西（315°）',
  西北: '北西（315°）',
  NE: '北东（45°）',
  SE: '南东（135°）',
  SW: '南西（225°）',
  NW: '北西（315°）',
  N: '北（0°）',
  E: '东（90°）',
  S: '南（180°）',
  W: '西（270°）',
}

const CANON_TRENDS = [...new Set(Object.values(TREND_ALIASES))]

export function canonicalTrend(input: unknown): string {
  const text = String(input ?? '').trim()
  if (text === '') {
    return ''
  }
  if (CANON_TRENDS.includes(text)) {
    return text
  }
  const upper = text.toUpperCase().replace(/\s+/g, '')
  if (TREND_ALIASES[upper]) {
    return TREND_ALIASES[upper]
  }
  const angleMatch = upper.match(/^(\d+(?:\.\d+)?)°$/)
  if (angleMatch) {
    const angle = Number(angleMatch[1]) % 360
    const snapped = Math.round(angle / 45) * 45 % 360
    const hit = CANON_TRENDS.find((trend) => trend.includes(`${snapped}°`))
    return hit ?? text
  }
  return text
}

function crackCode(row: EntryRow): string {
  return String(row[ID_FIELD] ?? '').trim()
}

// 同编号去重时保留哪一条：优先保留已经走到最后一段（已封填）的，否则保留阶段更靠后的。
function stageIndex(row: EntryRow): number {
  const idx = CRACK_STATUSES.indexOf(String(row.status) as CrackStatus)
  return idx < 0 ? -1 : idx
}

function pickCanonical(group: EntryRow[]): EntryRow {
  return [...group].sort((a, b) => stageIndex(b) - stageIndex(a) || Number(a.id) - Number(b.id))[0]
}

// 存量数据归并：同一条裂缝编号只保留一条（清掉重复封填产生的残留记录），
// 并把裂缝走向统一成规范写法。启动时和每次裂缝写入后都跑，保证各入口读到同一份。
export function reconcileCracks(): { removed: number } {
  const rows = listRows(CRACK_KEY)
  const groups = new Map<string, EntryRow[]>()
  for (const row of rows) {
    const code = crackCode(row)
    const list = groups.get(code) ?? []
    list.push(row)
    groups.set(code, list)
  }
  const deduped: EntryRow[] = []
  let removed = 0
  for (const group of groups.values()) {
    const canonical = pickCanonical(group)
    deduped.push({ ...canonical, [TREND_FIELD]: canonicalTrend(canonical[TREND_FIELD]) })
    removed += group.length - 1
  }
  // 尽量保持原有先后顺序
  deduped.sort((a, b) => Number(a.id) - Number(b.id))
  if (removed > 0 || rows.some((row) => row[TREND_FIELD] !== canonicalTrend(row[TREND_FIELD]))) {
    saveRows(CRACK_KEY, deduped)
  }
  return { removed }
}

export function listCracks(): EntryRow[] {
  return listRows(CRACK_KEY)
}

function findCrack(id: number): EntryRow | undefined {
  return listRows(CRACK_KEY).find((row) => Number(row.id) === id)
}

function findCrackByCode(code: string): EntryRow | undefined {
  const target = code.trim()
  return listRows(CRACK_KEY).find((row) => crackCode(row) === target)
}

function persist(rows: EntryRow[]): void {
  saveRows(CRACK_KEY, rows)
  reconcileCracks()
}

function requireStatus(row: EntryRow, action: string): ActionResult | null {
  const expected = ACTION_FROM[action]
  const current = String(row.status)
  if (current === '已封填') {
    return fail(`裂缝 ${crackCode(row)} 已封填，流程已结束，不能再执行「${action}」`)
  }
  if (current !== expected) {
    return fail(
      `状态只能逐段推进：${CRACK_STATUSES.join(' → ')}。当前是「${current}」，` +
        `不能直接「${action}」（该动作只允许「${expected}」的裂缝执行）`,
    )
  }
  return null
}

export type CrackStats = {
  pendingCount: number
  wideningCount: number
  maxTotalWidening: number
}

export function crackStats(rows: EntryRow[] = listRows(CRACK_KEY)): CrackStats {
  let maxTotal = 0
  for (const row of rows) {
    const total = parseWidth(row[TOTAL_FIELD])
    if (total !== null && total > maxTotal) {
      maxTotal = total
    }
  }
  return {
    pendingCount: rows.filter((row) => String(row.status) === '待观测').length,
    wideningCount: rows.filter((row) => String(row.status) === '持续变宽').length,
    maxTotalWidening: Math.round(maxTotal * 100) / 100,
  }
}

// 登记裂缝观测记录：编号必填且唯一，落库即为「待观测」。宽度不在登记环节填，避免落成无效值。
export function registerCrack(input: {
  code: string
  site: string
  trend: string
  observer?: string
  date?: string
}): ActionResult {
  const code = input.code.trim()
  if (!code) {
    return fail('裂缝编号不能为空')
  }
  reconcileCracks()
  if (findCrackByCode(code)) {
    return fail(`裂缝编号 ${code} 已存在，一条裂缝只允许登记一次`)
  }
  const rows = listRows(CRACK_KEY)
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const row: EntryRow = {
    id: nextId,
    status: '待观测',
    pending: true,
    abnormal: false,
    [ID_FIELD]: code,
    [SITE_FIELD]: input.site.trim(),
    [TREND_FIELD]: canonicalTrend(input.trend),
    [WIDTH_FIELD]: '',
    [TOTAL_FIELD]: '0',
    [DATE_FIELD]: input.date?.trim() ?? new Date().toISOString().slice(0, 10),
    [OBSERVER_FIELD]: input.observer?.trim() ?? '',
  }
  persist([...rows, row])
  return ok(`裂缝 ${code} 已登记，当前状态「待观测」，请提交首次观测`)
}

// 提交观测（待观测 → 稳定）：本期宽度必须是有效数值，无效值一律退回重填。
export function submitObservation(id: number, widthInput: string, observer?: string): ActionResult {
  reconcileCracks()
  const row = findCrack(id)
  if (!row) {
    return fail(`没有找到编号为 ${id} 的裂缝观测记录`)
  }
  const blocked = requireStatus(row, '提交观测')
  if (blocked) {
    return blocked
  }
  const width = parseWidth(widthInput)
  if (width === null) {
    return fail('本期宽度是无效值（需为不小于 0 的数字），请重新填写后再提交')
  }
  const rows = listRows(CRACK_KEY)
  const updated: EntryRow = {
    ...row,
    status: '稳定',
    pending: false,
    abnormal: false,
    [WIDTH_FIELD]: formatWidth(width),
    [TOTAL_FIELD]: '0',
    [DATE_FIELD]: new Date().toISOString().slice(0, 10),
  }
  if (observer && observer.trim()) {
    updated[OBSERVER_FIELD] = observer.trim()
  }
  persist(rows.map((item) => (Number(item.id) === id ? updated : item)))
  return ok(`裂缝 ${crackCode(row)} 已提交观测，当前状态「稳定」`)
}

// 标记变宽（稳定 → 持续变宽）。
// 本期宽度与裂缝走向打架时的优先级规则（写清在这里，各入口照此执行）：
// 「持续变宽」只看本期宽度是否大于上期宽度——宽度是定量数据，优先级高于裂缝走向；
// 裂缝走向只用于描述裂缝发育方位，走向发生变化不单独构成持续变宽。
// 宽度未增大时，即使走向有变化也只能继续按「稳定」观测。
export function markWidening(id: number, widthInput: string): ActionResult {
  reconcileCracks()
  const row = findCrack(id)
  if (!row) {
    return fail(`没有找到编号为 ${id} 的裂缝观测记录`)
  }
  const blocked = requireStatus(row, '标记变宽')
  if (blocked) {
    return blocked
  }
  const width = parseWidth(widthInput)
  if (width === null) {
    return fail('本期宽度是无效值（需为不小于 0 的数字），请重新填写后再提交')
  }
  const previous = parseWidth(row[WIDTH_FIELD])
  if (previous === null) {
    return fail('上一期宽度缺失或无效，无法比对，请先补齐上一期观测')
  }
  if (width <= previous) {
    return fail(
      `判定「持续变宽」以本期宽度为准（宽度优先于裂缝走向）：本期宽度 ${formatWidth(width)} ` +
        `不大于上期 ${formatWidth(previous)}，不能标记变宽，请继续按「稳定」观测`,
    )
  }
  const totalBefore = parseWidth(row[TOTAL_FIELD]) ?? 0
  const rows = listRows(CRACK_KEY)
  const updated: EntryRow = {
    ...row,
    status: '持续变宽',
    pending: true,
    abnormal: false,
    [WIDTH_FIELD]: formatWidth(width),
    [TOTAL_FIELD]: formatWidth(totalBefore + (width - previous)),
    [DATE_FIELD]: new Date().toISOString().slice(0, 10),
  }
  persist(rows.map((item) => (Number(item.id) === id ? updated : item)))
  return ok(`裂缝 ${crackCode(row)} 已标记变宽，自动进入「持续变宽」清单`)
}

// 提交复核：只对「持续变宽」的裂缝开放；重复复核按第一次已收处理，结论与待办都不重复生成。
export function submitReview(id: number, conclusion: string, reviewer?: string): ActionResult {
  reconcileCracks()
  const row = findCrack(id)
  if (!row) {
    return fail(`没有找到编号为 ${id} 的裂缝观测记录`)
  }
  const current = String(row.status)
  if (current !== '持续变宽') {
    return fail(`只有「持续变宽」的裂缝才能提交复核，当前是「${current}」`)
  }
  if (!REVIEW_OPTIONS.includes(conclusion)) {
    return fail('请选择复核结论')
  }
  if (row[REVIEW_FIELD]) {
    return ok(`重复复核按第一次结论「${row[REVIEW_FIELD]}」已收处理，不再重复处理`)
  }
  const rows = listRows(CRACK_KEY)
  const updated: EntryRow = {
    ...row,
    [REVIEW_FIELD]: conclusion,
    [REVIEWER_FIELD]: reviewer?.trim() || '值班管理员',
    [REVIEW_DATE_FIELD]: new Date().toISOString().slice(0, 10),
  }
  persist(rows.map((item) => (Number(item.id) === id ? updated : item)))
  if (conclusion === REVIEW_REQUIRE_TREATMENT) {
    createProjectTodo(updated)
  }
  return ok(
    conclusion === REVIEW_REQUIRE_TREATMENT
      ? `裂缝 ${crackCode(row)} 复核已收悉，已向治理工程生成一条待核项`
      : `裂缝 ${crackCode(row)} 复核已收悉，结论为继续观测研判`,
  )
}

// 登记封填（持续变宽 → 已封填）：按裂缝编号幂等，封填一次落库。
// 同一编号重复提交：第一次成功，之后一律按已收处理，不产生第二条记录。
// 同时清理该编号可能残留的重复记录；封填后自动退出持续变宽清单。
export function sealCrack(id: number): ActionResult {
  reconcileCracks()
  const row = findCrack(id)
  if (!row) {
    return fail(`没有找到编号为 ${id} 的裂缝观测记录`)
  }
  const current = String(row.status)
  if (current === '已封填') {
    return ok(`裂缝 ${crackCode(row)} 已封填，按第一次封填已收处理，不重复登记`)
  }
  const blocked = requireStatus(row, '登记封填')
  if (blocked) {
    return blocked
  }
  const rows = listRows(CRACK_KEY)
  const updated: EntryRow = {
    ...row,
    status: '已封填',
    pending: false,
    abnormal: false,
  }
  persist(rows.map((item) => (Number(item.id) === id ? updated : item)))
  return ok(`裂缝 ${crackCode(row)} 已封填落库，自动退出「持续变宽」清单`)
}

function listTodoRows(): TodoRow[] {
  return ((allRows()[PROJECT_TODO_KEY] as unknown as TodoRow[] | undefined) ?? [])
}

function saveTodoRows(rows: TodoRow[]): void {
  saveRows(PROJECT_TODO_KEY, rows as unknown as EntryRow[])
}

export type ProjectTodo = {
  id: number
  status: string
  title: string
  crackCode: string
  site: string
  conclusion: string
  reviewer: string
  createdAt: string
}

function toProjectTodo(row: TodoRow): ProjectTodo {
  return {
    id: Number(row.id),
    status: String(row.status),
    title: String(row.title ?? TODO_TITLE),
    crackCode: String(row.crackCode ?? ''),
    site: String(row.site ?? ''),
    conclusion: String(row.conclusion ?? ''),
    reviewer: String(row.reviewer ?? ''),
    createdAt: String(row.createdAt ?? ''),
  }
}

export function listProjectTodos(): ProjectTodo[] {
  return listTodoRows().map(toProjectTodo)
}

// 复核结论驱动治理工程待办：同一条裂缝只生成一条待核项（按 sourceKey 去重）。
function createProjectTodo(crack: EntryRow): void {
  const todos = listTodoRows()
  const sourceKey = `${CRACK_KEY}:${crackCode(crack)}`
  if (todos.some((row) => String(row.sourceKey) === sourceKey)) {
    return
  }
  const nextId = todos.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const todo: TodoRow = {
    id: nextId,
    status: '待核',
    source: TODO_SOURCE,
    sourceKey,
    title: TODO_TITLE,
    crackCode: crackCode(crack),
    site: String(crack[SITE_FIELD] ?? ''),
    trend: canonicalTrend(crack[TREND_FIELD]),
    conclusion: String(crack[REVIEW_FIELD] ?? REVIEW_REQUIRE_TREATMENT),
    reviewer: String(crack[REVIEWER_FIELD] ?? ''),
    target: TODO_TARGET,
    createdAt: new Date().toISOString().slice(0, 10),
  }
  saveTodoRows([...todos, todo])
}

// 治理工程侧核实完成：待核项闭环，不影响裂缝本身的状态。
export function resolveProjectTodo(id: number): ActionResult {
  const todos = listTodoRows()
  if (!todos.some((row) => Number(row.id) === id)) {
    return fail(`没有找到编号为 ${id} 的待核项`)
  }
  saveTodoRows(todos.map((row) => (Number(row.id) === id ? { ...row, status: '已核实' } : row)))
  return ok('待核项已核实闭环')
}
