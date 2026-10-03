<template>
  <section class="page" data-module="clearance">
    <header class="page-head">
      <div>
        <h2>隐患核销管理</h2>
        <p class="page-desc">维护核销单，围绕核销编号、所属隐患点、核销依据、复核人做登记、筛选与状态流转；复核结论会驱动治理工程待办。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记核销单</button>
        <button class="btn" type="button" @click="exportRows">导出隐患核销清单</button>
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
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-if="canSubmit(row.status)"
              class="link"
              type="button"
              @click="runAction('提交复核', row)"
            >
              提交复核
            </button>
            <button
              v-if="canReview(row.status)"
              class="link"
              type="button"
              @click="openReview(row)"
            >
              确认核销
            </button>
            <button
              v-if="canReview(row.status)"
              class="link"
              type="button"
              @click="runAction('驳回申请', row)"
            >
              驳回申请
            </button>
            <span v-if="!canSubmit(row.status) && !canReview(row.status)" class="muted-text">
              已按第一次复核结论处理
            </span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无隐患核销数据，可先登记核销单</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条隐患核销记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 复核弹窗：结论选「需工程治理」会在治理工程页生成一条待核项 -->
    <div v-if="reviewOpen" class="modal-mask" @click.self="reviewOpen = false">
      <div class="modal" role="dialog" aria-label="核销复核">
        <header class="modal-head"><h3>核销复核 · {{ reviewForm.code }}</h3></header>
        <div class="modal-body">
          <label class="form-item">
            <span>复核结论</span>
            <select v-model="reviewForm.核销结论">
              <option value="" disabled>请选择结论</option>
              <option v-for="item in conclusions" :key="item" :value="item">{{ item }}</option>
            </select>
          </label>
          <label class="form-item">
            <span>复核人</span>
            <input v-model="reviewForm.复核人" />
          </label>
          <label class="form-item">
            <span>复核日期</span>
            <input v-model="reviewForm.复核日期" type="date" />
          </label>
          <p class="rule-note">
            选「需工程治理」会向治理工程模块推送一条待核项；重复复核按第一次已收处理，不重复推送。
          </p>
          <p v-if="actionError" class="error-text">{{ actionError }}</p>
        </div>
        <footer class="modal-foot">
          <button class="btn" type="button" @click="reviewOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitReview">确认核销</button>
        </footer>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  CLEARANCE_CONCLUSIONS,
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('clearance')
const columns = ['核销编号', '所属隐患点', '核销依据', '复核人', '复核日期', '核销结论', '归档日期', '核销状态']
const conclusions = CLEARANCE_CONCLUSIONS
const statuses = ['待复核', '复核中', '已核销', '已驳回']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => [
  { label: '待复核核销单', value: rows.value.filter((r) => r.status === '待复核' || r.status === '复核中').length },
  { label: '已核销隐患点', value: rows.value.filter((r) => r.status === '已核销').length },
  { label: '已驳回申请', value: rows.value.filter((r) => r.status === '已驳回').length },
])

function canSubmit(status: string | number) {
  return String(status) === '待复核'
}
function canReview(status: string | number) {
  return String(status) === '复核中'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '核销单登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

const reviewOpen = ref(false)
const actionError = ref('')
const reviewId = ref<number | null>(null)
const reviewForm = reactive({ code: '', 核销结论: '', 复核人: '', 复核日期: '' })

function openReview(row: EntryRow) {
  actionError.value = ''
  reviewId.value = Number(row.id)
  reviewForm.code = String(row['核销编号'] ?? '')
  reviewForm.核销结论 = ''
  reviewForm.复核人 = String(row['复核人'] ?? '')
  reviewForm.复核日期 = new Date().toISOString().slice(0, 10)
  reviewOpen.value = true
}

function submitReview() {
  if (reviewId.value === null) {
    return
  }
  actionError.value = ''
  const result = applyAction(meta.key, reviewId.value, '确认核销', { ...reviewForm })
  if (!result.ok) {
    actionError.value = result.message
    return
  }
  reviewOpen.value = false
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '隐患核销列表读取失败'
  }
}

onMounted(reload)
</script>
