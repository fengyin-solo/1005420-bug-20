import assert from 'node:assert'
import {
  crackStats,
  listCracks,
  listProjectTodos,
  markWidening,
  reconcileCracks,
  registerCrack,
  resolveProjectTodo,
  sealCrack,
  submitObservation,
  submitReview,
} from '../src/api/crack-domain'
import { resetRows, saveRows } from '../src/data/local-store'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

// 每个用例前重置成 seed（3 条：待观测 / 稳定 / 持续变宽）
function reset() {
  resetRows('crack')
  resetRows('project-todos')
  reconcileCracks()
}

// 1. 封填一次落库、幂等、退出持续变宽、清残留
reset()
let rows = listCracks()
assert.strictEqual(rows.length, 3)
const widening = rows.find((r) => r['裂缝编号'] === 'CRAC-0003')!
assert.strictEqual(String(widening.status), '持续变宽')
let res = sealCrack(Number(widening.id))
assert.strictEqual(res.ok, true, res.message)
assert.strictEqual(String(listCracks().find((r) => r['裂缝编号'] === 'CRAC-0003')!.status), '已封填')
assert.strictEqual(crackStats().wideningCount, 0, '封填后应退出持续变宽清单')
// 同编号重复封填：幂等，不新增记录
res = sealCrack(Number(widening.id))
assert.strictEqual(res.ok, true)
assert.match(res.message, /已收/)
assert.strictEqual(listCracks().length, 3, '重复封填不能产生新记录')

// 2. 模拟历史残留：同一编号两条，启动归并清掉一条
reset()
{
  const base = listCracks()
  const dup = { ...base[2], id: 4, status: '已封填' }
  // 直接构造一条残留重复记录（同编号），跳过领域层
  saveRows('crack', [...base, dup])
  assert.strictEqual(listCracks().filter((r) => r['裂缝编号'] === 'CRAC-0003').length, 2)
  const { removed } = reconcileCracks()
  assert.strictEqual(removed, 1, '归并应清掉 1 条残留')
  const same = listCracks().filter((r) => r['裂缝编号'] === 'CRAC-0003')
  assert.strictEqual(same.length, 1)
  assert.strictEqual(String(same[0].status), '已封填', '保留走到最后一段的那条')
}

// 3. 跳级一律拦截
reset()
{
  const pending = listCracks().find((r) => r['裂缝编号'] === 'CRAC-0001')!
  assert.strictEqual(sealCrack(Number(pending.id)).ok, false, '待观测不能直接封填')
  assert.strictEqual(markWidening(Number(pending.id), '9').ok, false, '待观测不能直接标记变宽')
  const stable = listCracks().find((r) => r['裂缝编号'] === 'CRAC-0002')!
  assert.strictEqual(sealCrack(Number(stable.id)).ok, false, '稳定不能直接封填')
  assert.strictEqual(submitObservation(Number(stable.id), '9').ok, false, '稳定不能重复提交观测')
}

// 4. 正常逐段推进
reset()
{
  const id = Number(listCracks().find((r) => r['裂缝编号'] === 'CRAC-0001')!.id)
  assert.strictEqual(submitObservation(id, '2.5').ok, true)
  assert.strictEqual(String(listCracks().find((r) => Number(r.id) === id)!.status), '稳定')
  assert.strictEqual(markWidening(id, '4').ok, true)
  const row = listCracks().find((r) => Number(r.id) === id)!
  assert.strictEqual(String(row.status), '持续变宽')
  assert.strictEqual(String(row['累计变宽']), '1.5', '累计变宽=本期-上期')
  assert.strictEqual(sealCrack(id).ok, true)
  assert.strictEqual(String(listCracks().find((r) => Number(r.id) === id)!.status), '已封填')
}

// 5. 无效宽度退回重填
reset()
{
  const id1 = Number(listCracks().find((r) => r['裂缝编号'] === 'CRAC-0001')!.id)
  for (const bad of ['', 'abc', '-1', 'NaN', '  ']) {
    assert.strictEqual(submitObservation(id1, bad).ok, false, `宽度「${bad}」应退回`)
  }
  assert.strictEqual(String(listCracks().find((r) => Number(r.id) === id1)!.status), '待观测', '退回后状态不变')
  submitObservation(id1, '3')
  assert.strictEqual(markWidening(id1, '3').ok, false, '宽度不增大不能标记变宽')
  assert.strictEqual(markWidening(id1, '2').ok, false)
  assert.strictEqual(markWidening(id1, 'notnum').ok, false)
  assert.strictEqual(String(listCracks().find((r) => Number(r.id) === id1)!.status), '稳定')
}

// 6. 复核幂等 + 驱动治理工程待核项（同一裂缝只生成一条）
reset()
{
  const id = Number(listCracks().find((r) => r['裂缝编号'] === 'CRAC-0003')!.id)
  assert.strictEqual(listProjectTodos().length, 0)
  let r1 = submitReview(id, '需工程治理', '王复核')
  assert.strictEqual(r1.ok, true, r1.message)
  assert.strictEqual(listProjectTodos().length, 1)
  assert.strictEqual(listProjectTodos()[0].crackCode, 'CRAC-0003')
  assert.strictEqual(listProjectTodos()[0].status, '待核')
  // 重复复核按第一次已收
  let r2 = submitReview(id, '继续观测研判', '李复核')
  assert.strictEqual(r2.ok, true)
  assert.match(r2.message, /已收/)
  assert.strictEqual(listProjectTodos().length, 1, '重复复核不能多生成待核项')
  const row = listCracks().find((r) => Number(r.id) === id)!
  assert.strictEqual(String(row['复核结论']), '需工程治理', '结论保持第一次')
  assert.strictEqual(String(row['复核人']), '王复核')
  // 非持续变宽不能复核
  const stableId = Number(listCracks().find((r) => r['裂缝编号'] === 'CRAC-0002')!.id)
  assert.strictEqual(submitReview(stableId, '需工程治理').ok, false)
  // 继续观测研判不产生待办
  submitObservation(Number(listCracks().find((r) => r['裂缝编号'] === 'CRAC-0001')!.id), '1')
  const wideningId2 = Number(listCracks().find((r) => r['裂缝编号'] === 'CRAC-0001')!.id)
  markWidening(wideningId2, '5')
  const before = listProjectTodos().length
  assert.strictEqual(submitReview(wideningId2, '继续观测研判').ok, true)
  assert.strictEqual(listProjectTodos().length, before, '继续观测研判不生成待核项')
  // 待办闭环
  const todoId = listProjectTodos()[0].id
  assert.strictEqual(resolveProjectTodo(todoId).ok, true)
  assert.strictEqual(listProjectTodos()[0].status, '已核实')
}

// 7. 登记：编号唯一、走向归一化
reset()
{
  assert.strictEqual(registerCrack({ code: 'CRAC-0010', site: '某坡', trend: '东北' }).ok, true)
  const row = listCracks().find((r) => r['裂缝编号'] === 'CRAC-0010')!
  assert.strictEqual(String(row['裂缝走向']), '北东（45°）', '东北→北东（45°）')
  assert.strictEqual(String(row.status), '待观测')
  assert.strictEqual(registerCrack({ code: 'CRAC-0010', site: 'x', trend: 'N' }).ok, false, '重复编号拦下')
  assert.strictEqual(registerCrack({ code: '  ', site: 'x', trend: 'N' }).ok, false, '空编号拦下')
}

// 8. 各入口走向同一份：seed 里 北东 / NE / 45° 三种写法应统一
reset()
{
  const trends = listCracks().map((r) => String(r['裂缝走向']))
  assert.deepStrictEqual(trends, ['北东（45°）', '北东（45°）', '北东（45°）'], `实际：${JSON.stringify(trends)}`)
}

check('全部规则', () => {})
console.log(`\n${passed} 组用例通过（含 ${process.exitCode === 0 ? '' : ''}30+ 断言）`)
