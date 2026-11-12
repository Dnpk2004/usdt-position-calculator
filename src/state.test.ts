import { describe, expect, it } from 'vitest'
import { createCalculatorState, STORAGE_KEY } from './state'

function storage(initial?: string) {
  let value = initial ?? null
  return { getItem: () => value, setItem: (_k: string, v: string) => { value = v }, removeItem: () => { value = null } }
}
function ready() {
  const s = createCalculatorState(storage())
  s.update('entry', '100000'); s.update('stop', '98000')
  return s
}

describe('无循环的价格与百分比联动', () => {
  it('价格来源的派生距离使用可读精度，不反向污染原价格', () => {
    const s = createCalculatorState(storage())
    s.update('entry', '3'); s.update('stop', '2')
    expect(s.form.stopPercent.length).toBeLessThan(18)
    expect(s.form.stop).toBe('2')
    s.update('direction', 'short'); expect(s.form.stop).toBe('4')
  })
  it('价格为源时镜像方向，不经循环小数百分比还原', () => {
    const s = createCalculatorState(storage())
    s.update('entry', '3'); s.update('stop', '2'); s.update('take', '5')
    s.update('direction', 'short'); expect(s.form.stop).toBe('4'); expect(s.form.take).toBe('1')
    s.update('direction', 'short'); expect(s.form.stop).toBe('4')
    s.update('direction', 'long'); expect(s.form.stop).toBe('2'); expect(s.form.take).toBe('5')
  })
  it('错误百分比输入明确提示，不静默当成未填止盈', () => {
    const s = ready(); s.update('takePercent', 'abc')
    expect(s.percentError('takePercent')).toContain('有效正数')
    s.update('stopPercent', '-2')
    expect(s.percentError('stopPercent')).toContain('有效正数')
    s.update('takePercent', '4'); expect(s.percentError('takePercent')).toBeUndefined()
  })
  it('做多价格→百分比→价格，可连续输入', () => {
    const s = ready()
    expect(s.form.stopPercent).toBe('2')
    for (const value of ['1', '1.', '1.2', '1.25']) s.update('stopPercent', value)
    expect(s.form.stopPercent).toBe('1.25')
    expect(s.form.stop).toBe('98750')
    s.update('stop', '97000')
    expect(s.form.stopPercent).toBe('3')
  })
  it('编辑中的小数保留原始字符串', () => {
    const s = ready(); s.update('entry', '100000.')
    expect(s.form.entry).toBe('100000.')
    expect(s.result.value.position).not.toBeNull()
  })
  it('切换方向保留距离，重新映射止损和止盈', () => {
    const s = ready(); s.update('take', '104000'); s.update('direction', 'short')
    expect(s.form.stop).toBe('102000')
    expect(s.form.take).toBe('96000')
    expect(s.result.value.position!.ratio!.toString()).toBe('2')
    s.update('stopPercent', '1.5'); expect(s.form.stop).toBe('101500')
    s.update('takePercent', '3'); expect(s.form.take).toBe('97000')
    s.update('direction', 'long'); expect(s.form.take).toBe('103000')
  })
  it('修改开仓价按最后编辑来源更新', () => {
    const s = ready(); s.update('entry', '110000')
    expect(s.form.stop).toBe('98000')
    s.update('stopPercent', '2'); s.update('entry', '100000')
    expect(s.form.stop).toBe('98000')
    expect(s.form.stopPercent).toBe('2')
  })
  it('开仓缺失百分比不能生成旧价格', () => {
    const s = ready(); s.update('entry', ''); s.update('stopPercent', '2')
    expect(s.form.stop).toBe('')
    expect(s.result.value.position).toBeNull()
    s.update('entry', '100'); expect(s.form.stop).toBe('98')
  })
  it('非法百分比清掉关联价格，不保留有效结果', () => {
    const s = ready(); s.update('stopPercent', 'abc')
    expect(s.form.stop).toBe('')
    expect(s.result.value.position).toBeNull()
  })
  it('切换币种清空全部价格并保留风险偏好', () => {
    const s = ready(); s.update('symbol', 'ETH')
    expect(s.form.entry).toBe(''); expect(s.form.stop).toBe(''); expect(s.form.take).toBe('')
    expect(s.form.risk).toBe('50'); expect(s.result.value.position).toBeNull()
  })
  it('币种统一大小写和 USDT 后缀，不重复附加', () => {
    const s = ready(); s.update('symbol', 'dogeusdt')
    expect(s.form.symbol).toBe('DOGE')
    s.update('symbol', 'BTC'); expect(s.form.symbol).toBe('BTC')
  })
})

describe('本地有效设置恢复', () => {
  it('非法币种不能在刷新后变成 BTC 并沿用价格', () => {
    const db = storage(), s = createCalculatorState(db)
    s.update('symbol', '!'); s.update('entry', '1000'); s.update('stop', '990')
    expect(createCalculatorState(db).form.entry).toBe('')
  })
  it('缺失币种身份的存储不能恢复价格', () => {
    const db = storage(JSON.stringify({version: 1, form: { entry: '1000', stop: '990' }}))
    expect(createCalculatorState(db).form.entry).toBe('')
  })
  it('不足但有效的全仓余额刷新后仍保留，不回退到旧余额', () => {
    const db = storage(), s = createCalculatorState(db)
    s.update('entry', '100000'); s.update('stop', '98000'); s.update('mode', 'cross')
    s.update('wallet', '500'); s.update('wallet', '100')
    const t = createCalculatorState(db)
    expect(t.form.wallet).toBe('100'); expect(t.result.value.risk).toBe('gray')
    expect(t.result.value.issues.wallet).toContain('余额不足')
  })
  it('无效止盈百分比不污染有效交易快照', () => {
    const db = storage(), s = createCalculatorState(db)
    s.update('entry', '100000'); s.update('stop', '98000'); s.update('take', '104000')
    s.update('takePercent', 'abc')
    expect(createCalculatorState(db).form.take).toBe('104000')
  })
  it('保存并恢复有效输入与设定', () => {
    const db = storage(), s = createCalculatorState(db)
    s.update('entry', '100000'); s.update('stopPercent', '2'); s.update('takePercent', '4')
    s.update('risk', '100'); s.update('buffer', '25'); s.update('leverage', '20')
    const t = createCalculatorState(db)
    expect(t.form.entry).toBe('100000'); expect(t.form.stop).toBe('98000')
    expect(t.form.take).toBe('104000'); expect(t.form.risk).toBe('100')
    expect(t.form.buffer).toBe('25'); expect(t.form.leverage).toBe('20')
    expect(t.result.value.position!.notional.toString()).toBe('5000')
  })
  it('无效草稿不能污染最近有效交易快照', () => {
    const db = storage(), s = createCalculatorState(db)
    s.update('entry', '100000'); s.update('stop', '98000'); s.update('entry', 'abc')
    expect(createCalculatorState(db).form.entry).toBe('100000')
  })
  it('币种切换后刷新不恢复上一币种的价格', () => {
    const db = storage(), s = createCalculatorState(db)
    s.update('entry', '100000'); s.update('stop', '98000'); s.update('symbol', 'SOL')
    const t = createCalculatorState(db)
    expect(t.form.symbol).toBe('SOL'); expect(t.form.entry).toBe('')
  })
  it.each(['{bad', 'null', '[]', JSON.stringify({ version: 1, form: { entry: 'Infinity', stop: '1' } })])('损坏数据 %s 安全回退', value => {
    const t = createCalculatorState(storage(value))
    expect(t.result.value.position).toBeNull(); expect(t.form.risk).toBe('50')
  })
  it('存储不可用仍能计算并提示', () => {
    const db = { getItem() { throw Error('disabled') }, setItem() { throw Error('disabled') }, removeItem() { throw Error('disabled') } }
    const s = createCalculatorState(db)
    s.update('entry', '100000'); s.update('stop', '98000')
    expect(s.result.value.position!.notional.toString()).toBe('2500')
    expect(s.storageWarning.value).toBeTruthy()
  })
  it('重置恢复默认，清掉交易参数与存储', () => {
    const s = ready(); s.update('risk', '200'); s.reset()
    expect(s.form.entry).toBe(''); expect(s.form.risk).toBe('50'); expect(s.form.buffer).toBe('50')
  })
  it('存储键使用版本命名', () => expect(STORAGE_KEY).toContain('v1'))
})
