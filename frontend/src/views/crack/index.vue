<template>
  <section class="page" data-module="crack">
    <header class="page-head">
      <div>
        <h2>裂缝观测管理</h2>
        <p class="page-desc">维护裂缝观测记录，围绕裂缝编号、所属隐患点、裂缝走向、本期宽度做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记裂缝观测记录</button>
        <button class="btn" type="button" @click="exportRows">导出裂缝观测清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item legend-rule">{{ decisionPriority }}</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <button
              v-if="column === '裂缝编号'"
              class="link"
              type="button"
              @click="openDetail(Number(row.id))"
            >
              {{ row[column] }}
            </button>
            <template v-else>{{ formatCell(row, column) }}</template>
          </td>
          <td>
            <span :class="['status-tag', `status-${row.status}`]">{{ row.status }}</span>
          </td>
          <td class="row-actions">
            <button
              v-if="nextAction(row.status)"
              class="link"
              type="button"
              @click="openAction(String(nextAction(row.status)), row)"
            >
              {{ nextAction(row.status) }}
            </button>
            <span v-else class="muted-text">已到终态</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无裂缝观测数据，可先登记裂缝观测记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条裂缝观测记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 详情抽屉：纯只读，按 id 从同一份数据读取，关闭不改任何状态 -->
    <div v-if="detail" class="drawer-mask" @click.self="closeDetail">
      <aside class="drawer" role="dialog" aria-label="裂缝观测详情">
        <header class="drawer-head">
          <h3>裂缝观测详情</h3>
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </header>
        <dl class="detail-grid">
          <template v-for="column in columns" :key="column">
            <dt>{{ column }}</dt>
            <dd>{{ formatCell(detail, column) }}</dd>
          </template>
          <dt>当前状态</dt>
          <dd><span :class="['status-tag', `status-${detail.status}`]">{{ detail.status }}</span></dd>
        </dl>
        <p class="rule-note">判定口径：{{ decisionPriority }}</p>
        <footer class="drawer-foot">
          <button
            v-if="nextAction(String(detail.status))"
            class="btn primary"
            type="button"
            @click="openAction(String(nextAction(String(detail.status))), detail)"
          >
            {{ nextAction(String(detail.status)) }}
          </button>
        </footer>
      </aside>
    </div>

    <!-- 登记弹窗 -->
    <div v-if="createOpen" class="modal-mask" @click.self="createOpen = false">
      <div class="modal" role="dialog" aria-label="登记裂缝观测记录">
        <header class="modal-head"><h3>登记裂缝观测记录</h3></header>
        <div class="modal-body">
          <label class="form-item">
            <span>裂缝编号</span>
            <input v-model="createForm.裂缝编号" placeholder="如 CRAC-0008" />
          </label>
          <label class="form-item">
            <span>所属隐患点</span>
            <input v-model="createForm.所属隐患点" placeholder="如 青岩村后山滑坡" />
          </label>
          <label class="form-item">
            <span>裂缝走向</span>
            <select v-model="createForm.裂缝走向">
              <option value="" disabled>请选择</option>
              <option v-for="trend in trends" :key="trend" :value="trend">{{ trend }}</option>
            </select>
          </label>
          <label class="form-item">
            <span>本期宽度（mm，可不填，提交观测时补录）</span>
            <input v-model="createForm.本期宽度" placeholder="如 12.5" />
          </label>
          <label class="form-item">
            <span>观测日期</span>
            <input v-model="createForm.观测日期" type="date" />
          </label>
          <label class="form-item">
            <span>观测人</span>
            <input v-model="createForm.观测人" />
          </label>
          <p v-if="actionError" class="error-text">{{ actionError }}</p>
        </div>
        <footer class="modal-foot">
          <button class="btn" type="button" @click="createOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">提交登记</button>
        </footer>
      </div>
    </div>

    <!-- 动作弹窗：提交观测 / 标记变宽 / 登记封填 -->
    <div v-if="actionOpen" class="modal-mask" @click.self="actionOpen = false">
      <div class="modal" role="dialog" :aria-label="`${actionName}弹窗`">
        <header class="modal-head">
          <h3>{{ actionName }} · {{ actionForm.code }}</h3>
        </header>
        <div class="modal-body">
          <template v-if="actionName === '提交观测'">
            <label class="form-item">
              <span>裂缝走向（与清单同一字典）</span>
              <select v-model="actionForm.裂缝走向">
                <option value="" disabled>请选择</option>
                <option v-for="trend in trends" :key="trend" :value="trend">{{ trend }}</option>
              </select>
            </label>
            <label class="form-item">
              <span>本期宽度（mm）</span>
              <input v-model="actionForm.本期宽度" placeholder="如 12.5" />
            </label>
          </template>
          <template v-else-if="actionName === '标记变宽'">
            <p class="rule-note">
              上期宽度 {{ actionForm.baseline }}mm；判定口径：{{ decisionPriority }}。
              本期宽度必须大于上期，否则退回。
            </p>
            <label class="form-item">
              <span>本期宽度（mm）</span>
              <input v-model="actionForm.本期宽度" placeholder="如 15.0" />
            </label>
          </template>
          <template v-else>
            <p class="rule-note">
              封填只提交一次并落库，封填后该裂缝自动退出「持续变宽」、累计变宽冻结；
              重复提交封填不再产生记录。
            </p>
          </template>
          <label class="form-item">
            <span>观测日期</span>
            <input v-model="actionForm.观测日期" type="date" />
          </label>
          <label class="form-item">
            <span>观测人</span>
            <input v-model="actionForm.观测人" />
          </label>
          <p v-if="actionError" class="error-text">{{ actionError }}</p>
        </div>
        <footer class="modal-foot">
          <button class="btn" type="button" @click="actionOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitAction">确认{{ actionName }}</button>
        </footer>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  CRACK_DECISION_PRIORITY,
  CRACK_STATUSES,
  CRACK_TRENDS,
} from '@/data/crack'
import {
  createCrack,
  downloadEntries,
  getEntry,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('crack')
const columns = ['裂缝编号', '所属隐患点', '裂缝走向', '本期宽度', '累计变宽', '观测日期', '观测人', '裂缝状态']
const trends = CRACK_TRENDS
const decisionPriority = CRACK_DECISION_PRIORITY

// 状态只能逐段推进，这里给出每段唯一允许的下一步动作（跳级在服务层也会被拦下）。
const NEXT_ACTION: Record<string, string | null> = {
  待观测: '提交观测',
  稳定: '标记变宽',
  持续变宽: '登记封填',
  已封填: null,
}
function nextAction(status: string | number): string | null {
  return NEXT_ACTION[String(status)] ?? null
}

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const stats = computed(() => {
  const pending = rows.value.filter((row) => String(row.status) === '待观测').length
  const widening = rows.value.filter((row) => String(row.status) === '持续变宽').length
  const maxTotal = rows.value.reduce((max, row) => {
    const value = Number(row['累计变宽'])
    return Number.isFinite(value) ? Math.max(max, value) : max
  }, 0)
  return [
    { label: '待观测裂缝', value: pending },
    { label: '持续变宽裂缝', value: widening },
    { label: '累计变宽最大值(mm)', value: maxTotal },
  ]
})

const statusSummary = computed(() =>
  CRACK_STATUSES.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function formatCell(row: EntryRow, column: string): string {
  if (column === '本期宽度' || column === '累计变宽') {
    const value = row[column]
    if (value === '' || value === undefined || value === null) {
      return column === '累计变宽' ? '0 mm' : '—'
    }
    return `${value} mm`
  }
  if (column === '裂缝状态') {
    return String(row.status)
  }
  return String(row[column] ?? '—')
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '裂缝观测列表读取失败'
  }
}

// ----- 详情抽屉：按 id 取同一份数据，关闭只收起抽屉，绝不回写状态 -----
const detailId = ref<number | null>(null)
const detail = computed<EntryRow | null>(() =>
  detailId.value === null ? null : getEntry(meta.key, detailId.value),
)

function openDetail(id: number) {
  detailId.value = id
}

function closeDetail() {
  detailId.value = null
}

// ----- 登记弹窗 -----
const createOpen = ref(false)
const actionError = ref('')
const createForm = reactive({
  裂缝编号: '',
  所属隐患点: '',
  裂缝走向: '',
  本期宽度: '',
  观测日期: '',
  观测人: '',
})

function openCreate() {
  actionError.value = ''
  Object.assign(createForm, {
    裂缝编号: '',
    所属隐患点: '',
    裂缝走向: '',
    本期宽度: '',
    观测日期: '',
    观测人: '',
  })
  createOpen.value = true
}

function submitCreate() {
  actionError.value = ''
  const result = createCrack({ ...createForm })
  if (!result.ok) {
    actionError.value = result.message
    return
  }
  createOpen.value = false
  reload()
}

// ----- 动作弹窗 -----
const actionOpen = ref(false)
const actionName = ref('')
const actionId = ref<number | null>(null)
const actionForm = reactive({
  code: '',
  裂缝走向: '',
  本期宽度: '',
  baseline: 0,
  观测日期: '',
  观测人: '',
})

function openAction(action: string, row: EntryRow) {
  // 弹窗与页面读的是同一条：始终按 id 重新从数据层取，避免拿行内旧值。
  const latest = getEntry(meta.key, Number(row.id))
  if (!latest) {
    errorMessage.value = '该裂缝记录不存在或已被清理'
    reload()
    return
  }
  actionError.value = ''
  actionName.value = action
  actionId.value = Number(latest.id)
  const baseline = Number(latest['本期宽度'])
  Object.assign(actionForm, {
    code: String(latest['裂缝编号'] ?? ''),
    裂缝走向: String(latest['裂缝走向'] ?? ''),
    本期宽度: '',
    baseline: Number.isFinite(baseline) ? baseline : 0,
    观测日期: String(latest['观测日期'] ?? ''),
    观测人: String(latest['观测人'] ?? ''),
  })
  actionOpen.value = true
}

function submitAction() {
  if (actionId.value === null) {
    return
  }
  actionError.value = ''
  const result = applyAction(meta.key, actionId.value, actionName.value, { ...actionForm })
  if (!result.ok) {
    actionError.value = result.message
    return
  }
  actionOpen.value = false
  closeDetail()
  reload()
}

onMounted(reload)
</script>
