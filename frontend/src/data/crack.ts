/**
 * 裂缝领域的统一口径：所有入口（清单、登记表单、详情抽屉、复核/治理联动）
 * 都从这里读裂缝走向、状态顺序和宽度规则，禁止各页面再各抄一份。
 */

/** 裂缝走向只允许从这一份字典里选，页面、弹窗、抽屉共用。 */
export const CRACK_TRENDS = ['近水平', '顺坡向', '逆坡向', '斜交', '近竖直'] as const

export type CrackTrend = (typeof CRACK_TRENDS)[number]

/** 裂缝状态必须逐段推进，顺序即流程，不允许跳级。 */
export const CRACK_STATUSES = ['待观测', '稳定', '持续变宽', '已封填'] as const

export type CrackStatus = (typeof CRACK_STATUSES)[number]

/** 每个动作只接受「紧邻上一状态」发起，命中其他状态一律拦下。 */
export const CRACK_TRANSITIONS: Record<string, CrackStatus[]> = {
  提交观测: ['待观测'],
  标记变宽: ['稳定'],
  登记封填: ['持续变宽'],
}

/**
 * 本期宽度与裂缝走向打架时的优先级：
 * 以本期宽度的实测数值为第一依据——宽度未增大，即使走向与坡体结构
 * 一致（如顺坡向）也不得判为持续变宽；宽度确有增大，走向不作为否决条件。
 * 裂缝走向仅用于辅助描述与现场分析。
 */
export const CRACK_DECISION_PRIORITY = '本期宽度实测值优先，裂缝走向仅作辅助判定'

/** 宽度的合法范围：毫米，非负、有限，过大会被当成录入错误。 */
export const CRACK_WIDTH_MAX_MM = 100000

/** 把任意录入值解析为毫米数；非法值（空、文字、负数、无穷）一律返回 null。 */
export function parseWidthMm(raw: unknown): number | null {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0 || raw > CRACK_WIDTH_MAX_MM) {
      return null
    }
    return Number(raw.toFixed(2))
  }
  const text = String(raw ?? '').trim()
  if (text === '') {
    return null
  }
  // 允许 “12.3” 与 “12.3mm” 两种写法，其余文字一律无效。
  const matched = text.match(/^(-?\d+(?:\.\d+)?)\s*(mm|毫米)?$/i)
  if (!matched) {
    return null
  }
  const value = Number(matched[1])
  if (!Number.isFinite(value) || value < 0 || value > CRACK_WIDTH_MAX_MM) {
    return null
  }
  return Number(value.toFixed(2))
}

export function isValidWidthMm(raw: unknown): boolean {
  return parseWidthMm(raw) !== null
}

/** 累计变宽：从「初测宽度」起算的累计增量，封填后冻结，不再改写。 */
export function accumulateWidth(previousTotal: number, baseline: number, current: number): number {
  return Number((Number(previousTotal || 0) + (current - baseline)).toFixed(2))
}
