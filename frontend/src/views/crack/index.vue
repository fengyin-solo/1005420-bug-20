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
      <article class="stat-card">
        <span class="stat-label">待观测裂缝</span>
        <strong class="stat-value">{{ stats.pendingCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">持续变宽裂缝</span>
        <strong class="stat-value">{{ stats.wideningCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">累计变宽最大值（mm）</span>
        <strong class="stat-value">{{ stats.maxTotalWidening }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <nav class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="tab"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}（{{ tab.count }}）
      </button>
    </nav>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <p class="rule-note">
      判定规则：状态只能逐段推进（待观测 → 稳定 → 持续变宽 → 已封填），跳级一律拦截；
      本期宽度与裂缝走向打架时，<strong>以本期宽度为准</strong>（宽度定量、走向只描述方位，走向变化不单独构成持续变宽）；
      本期宽度为无效值（空值、非数字、负数）一律退回重填。
    </p>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in visibleRows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <button
              v-if="column === '裂缝编号'"
              type="button"
              class="link"
              @click="openDrawer(Number(row.id))"
            >
              {{ row[column] ?? '—' }}
            </button>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>
            <span class="status-badge" :data-status="row.status">{{ row.status }}</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in actionsFor(row)"
              :key="action.name"
              class="link"
              type="button"
              @click="openAction(action.name, Number(row.id))"
            >
              {{ action.label }}
            </button>
            <span v-if="!actionsFor(row).length" class="muted-text">—</span>
          </td>
        </tr>
        <tr v-if="!visibleRows.length">
          <td :colspan="columns.length + 2" class="empty-state">
            {{ activeTab === '持续变宽' ? '持续变宽清单为空：已封填的裂缝会自动退出本清单' : '暂无裂缝观测数据，可先登记裂缝观测记录' }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条裂缝观测记录</span>
      <span v-if="message" :class="messageOk ? 'success-text' : 'error-text'">{{ message }}</span>
    </footer>

    <!-- 详情抽屉：与清单读同一份数据（按 id 实时从数据层取），点开不会空白 -->
    <div v-if="drawerId !== null" class="drawer-mask" @click.self="closeDrawer">
      <aside class="drawer">
        <header class="drawer-head">
          <h3>裂缝观测详情</h3>
          <button type="button" class="btn ghost" @click="closeDrawer">返回清单</button>
        </header>
        <template v-if="drawerRow">
          <dl class="detail-list">
            <template v-for="column in columns" :key="column">
              <dt>{{ column }}</dt>
              <dd>{{ drawerRow[column] || '—' }}</dd>
            </template>
            <dt>当前状态</dt>
            <dd><span class="status-badge" :data-status="drawerRow.status">{{ drawerRow.status }}</span></dd>
            <template v-if="drawerRow['复核结论']">
              <dt>复核结论</dt>
              <dd>{{ drawerRow['复核结论'] }}</dd>
              <dt>复核人</dt>
              <dd>{{ drawerRow['复核人'] || '—' }}</dd>
              <dt>复核日期</dt>
              <dd>{{ drawerRow['复核日期'] || '—' }}</dd>
            </template>
          </dl>
          <div class="drawer-actions">
            <button
              v-for="action in actionsFor(drawerRow)"
              :key="action.name"
              type="button"
              class="btn"
              :class="{ primary: action.name === '登记封填' }"
              @click="openAction(action.name, Number(drawerRow.id))"
            >
              {{ action.label }}
            </button>
          </div>
        </template>
        <p v-else class="empty-state">该裂缝记录不存在（可能已被清理），返回清单查看最新数据。</p>
      </aside>
    </div>

    <!-- 通用弹窗：页面与弹窗展示、操作的都是同一条记录 -->
    <div v-if="modal !== ''" class="modal-mask" @click.self="closeModal">
      <div class="modal">
        <header class="modal-head">
          <h3>{{ modalTitle }}</h3>
        </header>

        <form v-if="modal === 'create'" @submit.prevent="submitCreate">
          <label class="form-item">
            <span>裂缝编号 *</span>
            <input v-model="form.code" placeholder="例如 CRAC-0010" />
          </label>
          <label class="form-item">
            <span>所属隐患点</span>
            <input v-model="form.site" placeholder="所属隐患点名称" />
          </label>
          <label class="form-item">
            <span>裂缝走向</span>
            <input v-model="form.trend" list="trend-options" placeholder="如 北东、45°、NE" />
            <datalist id="trend-options">
              <option v-for="trend in trendOptions" :key="trend" :value="trend" />
            </datalist>
            <small class="muted-text">支持 北/南/东/西/北东（东北、NE、45°）等写法，保存时统一成规范格式</small>
          </label>
          <label class="form-item">
            <span>观测人</span>
            <input v-model="form.observer" />
          </label>
          <label class="form-item">
            <span>观测日期</span>
            <input v-model="form.date" type="date" />
          </label>
          <p class="form-tip">登记后为「待观测」，宽度在「提交观测」时填写；无效宽度会被退回重填。</p>
          <div class="modal-actions">
            <button type="button" class="btn ghost" @click="closeModal">取消</button>
            <button type="submit" class="btn primary">提交登记</button>
          </div>
        </form>

        <form v-else-if="modal === 'observe'" @submit.prevent="submitObserve">
          <p class="form-tip">裂缝 {{ modalRowCode }}：提交首次观测，状态从「待观测」推进到「稳定」。</p>
          <label class="form-item">
            <span>本期宽度（mm）*</span>
            <input v-model="form.width" inputmode="decimal" placeholder="不小于 0 的数字" />
          </label>
          <label class="form-item">
            <span>观测人</span>
            <input v-model="form.observer" />
          </label>
          <div class="modal-actions">
            <button type="button" class="btn ghost" @click="closeModal">取消</button>
            <button type="submit" class="btn primary">提交观测</button>
          </div>
        </form>

        <form v-else-if="modal === 'widen'" @submit.prevent="submitWiden">
          <p class="form-tip">
            裂缝 {{ modalRowCode }}：本期宽度大于上期才能标记为「持续变宽」；宽度与走向打架时以宽度为准。
          </p>
          <label class="form-item">
            <span>上期宽度（mm）</span>
            <input :value="modalRowPreviousWidth" disabled />
          </label>
          <label class="form-item">
            <span>本期宽度（mm）*</span>
            <input v-model="form.width" inputmode="decimal" placeholder="须大于上期宽度" />
          </label>
          <div class="modal-actions">
            <button type="button" class="btn ghost" @click="closeModal">取消</button>
            <button type="submit" class="btn primary">标记变宽</button>
          </div>
        </form>

        <form v-else-if="modal === 'review'" @submit.prevent="submitReview">
          <p class="form-tip">
            裂缝 {{ modalRowCode }}：仅「持续变宽」可复核；重复复核按第一次已收处理。
            结论为「需工程治理」时，向治理工程生成一条待核项（同一裂缝只生成一条）。
          </p>
          <label v-for="option in reviewOptions" :key="option" class="form-item radio-item">
            <input v-model="form.conclusion" type="radio" name="review-conclusion" :value="option" />
            <span>{{ option }}</span>
          </label>
          <label class="form-item">
            <span>复核人</span>
            <input v-model="form.reviewer" />
          </label>
          <p v-if="modalRowReview" class="form-tip">
            该裂缝已有复核结论「{{ modalRowReview }}」，再次提交不会覆盖，也不会重复生成待核项。
          </p>
          <div class="modal-actions">
            <button type="button" class="btn ghost" @click="closeModal">取消</button>
            <button type="submit" class="btn primary">提交复核</button>
          </div>
        </form>

        <form v-else-if="modal === 'seal'" @submit.prevent="submitSeal">
          <p class="form-tip">
            裂缝 {{ modalRowCode }}：确认封填后落库为「已封填」，自动退出持续变宽清单；
            同编号重复提交只按第一次封填处理，不产生第二条记录，历史残留的重复记录会一并清掉。
          </p>
          <div class="modal-actions">
            <button type="button" class="btn ghost" @click="closeModal">取消</button>
            <button type="submit" class="btn primary">确认封填</button>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadEntries, filterRows, moduleMeta } from '@/api/local-service'
import {
  REVIEW_OPTIONS,
  canonicalTrend,
  crackStats,
  listCracks,
  markWidening,
  reconcileCracks,
  registerCrack,
  sealCrack,
  submitObservation,
  submitReview as submitReviewAction,
} from '@/api/crack-domain'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('crack')
const columns = ['裂缝编号', '所属隐患点', '裂缝走向', '本期宽度', '累计变宽', '观测日期', '观测人', '裂缝状态']
const filterFields = columns.slice(0, 3)
const trendOptions = ['北（0°）', '东（90°）', '南（180°）', '西（270°）', '北东（45°）', '南东（135°）', '南西（225°）', '北西（315°）']
const reviewOptions = REVIEW_OPTIONS

const TAB_KEYS = ['全部', '待观测', '稳定', '持续变宽', '已封填'] as const
type TabKey = (typeof TAB_KEYS)[number]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const message = ref('')
const messageOk = ref(true)
const filters = ref<Record<string, string>>({})
const activeTab = ref<TabKey>('全部')

const drawerId = ref<number | null>(null)
const modal = ref<'' | 'create' | 'observe' | 'widen' | 'review' | 'seal'>('')
const modalId = ref<number | null>(null)

const form = reactive({
  code: '',
  site: '',
  trend: '',
  observer: '',
  date: '',
  width: '',
  conclusion: '',
  reviewer: '',
})

const stats = computed(() => crackStats(rows.value))
const statusSummary = computed(() =>
  ['待观测', '稳定', '持续变宽', '已封填'].map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const visibleRows = computed(() => {
  const filtered = filterRows(rows.value, filters.value)
  if (activeTab.value === '全部') {
    return filtered
  }
  return filtered.filter((row) => String(row.status) === activeTab.value)
})

const tabs = computed(() =>
  TAB_KEYS.map((key) => ({
    key,
    label: key === '全部' ? '全部' : key,
    count: key === '全部' ? rows.value.length : rows.value.filter((row) => String(row.status) === key).length,
  })),
)

// 抽屉、弹窗都按 id 实时从 rows（reload 自数据层）里取，保证页面和弹窗是同一条。
const drawerRow = computed(() =>
  drawerId.value === null ? undefined : rows.value.find((row) => Number(row.id) === drawerId.value),
)
const modalRow = computed(() =>
  modalId.value === null ? undefined : rows.value.find((row) => Number(row.id) === modalId.value),
)
const modalRowCode = computed(() => (modalRow.value ? String(modalRow.value['裂缝编号'] ?? '') : ''))
const modalRowPreviousWidth = computed(() => String(modalRow.value?.['本期宽度'] ?? ''))
const modalRowReview = computed(() =>
  modalRow.value?.['复核结论'] ? String(modalRow.value['复核结论']) : '',
)

const modalTitle = computed(() => {
  switch (modal.value) {
    case 'create':
      return '登记裂缝观测记录'
    case 'observe':
      return '提交观测'
    case 'widen':
      return '标记持续变宽'
    case 'review':
      return '提交复核'
    case 'seal':
      return '登记封填'
    default:
      return ''
  }
})

// 各状态下可执行的动作严格对应状态机；已封填没有任何后续动作。
function actionsFor(row: EntryRow): { name: string; label: string }[] {
  switch (String(row.status)) {
    case '待观测':
      return [{ name: '提交观测', label: '提交观测' }]
    case '稳定':
      return [{ name: '标记变宽', label: '标记变宽' }]
    case '持续变宽':
      return [
        { name: '提交复核', label: '提交复核' },
        { name: '登记封填', label: '登记封填' },
      ]
    default:
      return []
  }
}

function resetForm() {
  form.code = ''
  form.site = ''
  form.trend = ''
  form.observer = ''
  form.date = ''
  form.width = ''
  form.conclusion = ''
  form.reviewer = ''
}

function flash(result: { ok: boolean; message: string }) {
  messageOk.value = result.ok
  message.value = result.message
}

function resetFilters() {
  filters.value = {}
  message.value = ''
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  resetForm()
  modal.value = 'create'
}

function openDrawer(id: number) {
  drawerId.value = id
}

function closeDrawer() {
  drawerId.value = null
  message.value = ''
  // 关闭即回到清单视图，数据在每次动作后已 reload，不会走样、也不会变回旧状态
  reload()
}

function openAction(action: string, id: number) {
  modalId.value = id
  resetForm()
  if (action === '提交观测') {
    modal.value = 'observe'
  } else if (action === '标记变宽') {
    modal.value = 'widen'
  } else if (action === '提交复核') {
    modal.value = 'review'
    form.conclusion = String(modalRow.value?.['复核结论'] ?? '')
  } else if (action === '登记封填') {
    modal.value = 'seal'
  }
}

function closeModal() {
  modal.value = ''
  modalId.value = null
  resetForm()
}

function finish(result: { ok: boolean; message: string }) {
  flash(result)
  if (result.ok) {
    closeModal()
  }
  reload()
}

function submitCreate() {
  finish(
    registerCrack({
      code: form.code,
      site: form.site,
      trend: canonicalTrend(form.trend),
      observer: form.observer,
      date: form.date,
    }),
  )
}

function submitObserve() {
  if (modalId.value === null) {
    return
  }
  finish(submitObservation(modalId.value, form.width, form.observer))
}

function submitWiden() {
  if (modalId.value === null) {
    return
  }
  finish(markWidening(modalId.value, form.width))
}

function submitReview() {
  if (modalId.value === null) {
    return
  }
  finish(submitReviewAction(modalId.value, form.conclusion, form.reviewer))
}

function submitSeal() {
  if (modalId.value === null) {
    return
  }
  finish(sealCrack(modalId.value))
}

function reload() {
  try {
    // 每次渲染前先归并：清残留重复记录、统一走向，保证清单/抽屉/弹窗读的是同一份
    reconcileCracks()
    rows.value = listCracks()
    total.value = rows.value.length
  } catch (error) {
    messageOk.value = false
    message.value = error instanceof Error ? error.message : '裂缝观测列表读取失败'
  }
}

onMounted(reload)
</script>
