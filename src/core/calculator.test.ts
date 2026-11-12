import { describe, expect, it } from 'vitest'
import { calculate, type TradeInput } from './calculator'
import { money, price, quantity } from './format'

const base: TradeInput = {
  direction: 'long', mode: 'isolated', entry: '100000', stop: '98000', take: '',
  risk: '50', leverage: '10', buffer: '50', wallet: '', mmr: '0.5', maintenance: '0',
}
const run = (overrides: Partial<TradeInput> = {}) => calculate({ ...base, ...overrides })

describe('仓位与线性盈亏', () => {
  it('做多 50U 风险得到 2500U、0.025BTC、2% 和 250U 保证金', () => {
    const p = run().position!
    expect(p.notional.toString()).toBe('2500')
    expect(p.quantity.toString()).toBe('0.025')
    expect(p.stopPercent.toString()).toBe('2')
    expect(p.initialMargin!.toString()).toBe('250')
    expect(p.loss.toString()).toBe('50')
  })
  it('做空正确计算仓位', () => {
    const p = run({ direction: 'short', stop: '102000' }).position!
    expect(p.quantity.toString()).toBe('0.025')
    expect(p.notional.toString()).toBe('2500')
  })
  it.each([['long', '98000', '104000'], ['short', '102000', '96000']] as const)(
    '%s 止盈盈利 100、盈亏比 2', (direction, stop, take) => {
      const p = run({ direction, stop, take }).position!
      expect(p.profit!.toString()).toBe('100')
      expect(p.ratio!.toString()).toBe('2')
    })
  it.each([['5', '500'], ['10', '250'], ['20', '125']])('杠杆 %s 不改变仓位', (leverage, margin) => {
    const p = run({ leverage }).position!
    expect(p.initialMargin!.toString()).toBe(margin)
    expect(p.notional.toString()).toBe('2500')
    expect(p.quantity.toString()).toBe('0.025')
  })
  it('止盈缺失不影响仓位', () => {
    expect(run().position!.profit).toBeNull()
    expect(run().position!.ratio).toBeNull()
  })
  it('错误止盈隔离收益且给出提示', () => {
    const r = run({ take: '90000' })
    expect(r.position!.notional.toString()).toBe('2500')
    expect(r.position!.profit).toBeNull()
    expect(r.issues.take).toContain('高于')
  })
  it('低价币十进制计算不损失精度', () => {
    const p = run({ entry: '0.000001', stop: '0.00000098' }).position!
    expect(p.notional.toString()).toBe('2500')
    expect(p.quantity.toString()).toBe('2500000000')
  })
})

describe('参数校验', () => {
  it.each(['', '0', '-1', 'abc', 'NaN', 'Infinity', '1e9999', '1e19', '0x10', '1'.repeat(100)])('拒绝无效开仓价 %s', entry => {
    expect(run({ entry }).position).toBeNull()
    expect(run({ entry }).issues.entry).toBeTruthy()
  })
  it.each(['', '0', '-1', '100000', '100001'])('拒绝做多无效止损 %s', stop => {
    expect(run({ stop }).position).toBeNull()
  })
  it('做空不能使用做多的止损', () => expect(run({ direction: 'short' }).issues.stop).toContain('高于'))
  it.each(['', '0', '-1', 'foo', '1e30'])('无效风险 %s', risk => expect(run({ risk }).position).toBeNull())
  it.each(['', '0', '-1', '126', 'foo'])('无效杠杆 %s 保留仓位但不计算保证金/强平', leverage => {
    const r = run({ leverage })
    expect(r.issues.leverage).toBeTruthy()
    expect(r.position!.initialMargin).toBeNull()
    expect(r.risk).toBe('gray')
  })
  it('极小距离造成异常名义仓位时拒绝', () => {
    const r = run({ stop: '99999.999999999999999999999999' })
    expect(r.position).toBeNull()
    expect(r.issues.stop).toContain('仓位')
  })
  it.each(['-1', '100', 'abc'])('无效 MMR %s 不影响基础仓位', mmr => {
    const r = run({ mmr })
    expect(r.position).not.toBeNull()
    expect(r.risk).toBe('gray')
    expect(r.liquidation).toBeNull()
  })
  it('无效缓冲不给风险结论', () => expect(run({ buffer: '-1' }).risk).toBe('gray'))
  it('扣减额为负不估算', () => expect(run({ maintenance: '-1' }).liquidation).toBeNull())
})

describe('维持保证金与强平模型', () => {
  it.each(['isolated', 'cross'] as const)('%s 循环小数数量不影响强平恰等于止损的边界', mode => {
    const r = run({ mode, entry: '6', stop: '3', risk: '5', leverage: '2', mmr: '0', buffer: '0', wallet: '5' })
    expect(r.liquidation!.toString()).toBe('3')
    expect(r.risk).toBe('red')
    if (mode === 'isolated') { expect(r.highest).toBeNull(); expect(r.conservative).toBeNull() }
  })
  it('全仓余额恰好满足初始保证金，不因循环小数误判不足', () => {
    const r = run({ mode: 'cross', entry: '14', stop: '7', risk: '2', leverage: '2', wallet: '2', mmr: '0' })
    expect(r.issues.wallet).toBeUndefined()
    expect(r.position!.initialMargin!.toString()).toBe('2')
    expect(r.risk).toBe('red')
  })
  it('仓位未填时全仓余额仍独立校验', () => {
    const r = run({ entry: '', stop: '', mode: 'cross', wallet: '1e99' })
    expect(r.issues.wallet).toContain('有效非负数')
  })
  it('做多求解权益等于维持保证金，不使用破产价', () => {
    const r = run(), p = r.position!, l = r.liquidation!
    expect(l.toNumber()).toBeCloseTo(90452.26130653266, 7)
    expect(p.initialMargin!.plus(p.quantity.mul(l.minus('100000'))).minus(p.quantity.mul(l).mul('0.005')).abs().lt('1e-65')).toBe(true)
  })
  it('做空公式与权益等式一致，扣减额符号正确', () => {
    const r = run({ direction: 'short', stop: '102000', maintenance: '1' })
    const p = r.position!, l = r.liquidation!
    expect(p.initialMargin!.plus(p.quantity.mul(l.neg().plus('100000'))).minus(p.quantity.mul(l).mul('0.005').minus(1)).abs().lt('1e-65')).toBe(true)
  })
  it('做多 20 倍 10% 止损，先强平风险为红', () => expect(run({ stop: '90000', leverage: '20' }).risk).toBe('red'))
  it('做空高杠杆反向判断仍为红', () => expect(run({ direction: 'short', stop: '110000', leverage: '20' }).risk).toBe('red'))
  it.each(['long', 'short'] as const)('%s 在止损边界相等按红色处理', direction => {
    const a = run({ direction, stop: direction === 'long' ? '98000' : '102000', mmr: '0', leverage: '50' })
    expect(a.risk).toBe('red')
  })
  it('缓冲 25/50/100 改变风险和推荐', () => {
    expect(run({ leverage: '30', buffer: '25' }).risk).toBe('green')
    expect(run({ leverage: '30', buffer: '50' }).risk).toBe('yellow')
    expect(run({ leverage: '30', buffer: '100' }).risk).toBe('yellow')
    expect(run({ buffer: '25' }).conservative).toBe(33)
    expect(run({ buffer: '50' }).conservative).toBe(28)
    expect(run({ buffer: '100' }).conservative).toBe(22)
    expect(run().highest).toBe(40)
  })
  it.each(['long', 'short'] as const)('%s 推荐是满足条件的最高整数', direction => {
    const stop = direction === 'long' ? '98000' : '102000'
    const r = run({ direction, stop })
    expect(r.highest).not.toBeNull()
    for (let l = 1; l <= 125; l++) {
      const v = run({ direction, stop, leverage: String(l) })
      if (l === r.highest) expect(['yellow', 'green']).toContain(v.risk)
      if (l > r.highest!) expect(['red', 'gray']).toContain(v.risk)
      if (l === r.conservative) expect(v.risk).toBe('green')
      if (l > r.conservative!) expect(v.risk).not.toBe('green')
    }
  })
  it('没有符合条件的倍数返回空值', () => {
    const r = run({ direction: 'short', stop: '300000' })
    expect(r.highest).toBeNull()
    expect(r.conservative).toBeNull()
  })
  it('固定全仓余额改变杠杆不改变强平价', () => {
    const a = run({ mode: 'cross', wallet: '500', leverage: '5' })
    const b = run({ mode: 'cross', wallet: '500', leverage: '20' })
    expect(a.liquidation!.eq(b.liquidation!)).toBe(true)
    expect(a.position!.initialMargin!.eq(b.position!.initialMargin!)).toBe(false)
    expect(a.highest).toBeNull()
    expect(a.conservative).toBeNull()
  })
  it('全仓未填余额不作安全判断', () => {
    const r = run({ mode: 'cross' })
    expect(r.position).not.toBeNull()
    expect(r.liquidation).toBeNull()
    expect(r.risk).toBe('gray')
    expect(r.liquidationMessage).toContain('余额')
  })
  it('全仓余额不足但仍保留理论初始保证金', () => {
    const r = run({ mode: 'cross', wallet: '100' })
    expect(r.issues.wallet).toContain('余额不足')
    expect(r.position!.initialMargin!.toString()).toBe('250')
    expect(r.risk).toBe('gray')
  })
  it('非正强平价不输出数字或安全结论', () => {
    const r = run({ leverage: '1', mmr: '0' })
    expect(r.liquidation).toBeNull()
    expect(r.risk).toBe('gray')
    expect(r.liquidationMessage).toContain('无有效正价格')
  })
  it('负维持保证金的假设无实际意义', () => {
    const r = run({ maintenance: '1000' })
    expect(r.liquidation).toBeNull()
    expect(r.risk).toBe('gray')
    expect(r.highest).toBeNull()
  })
  it('开仓即不满足维持保证金时显示风险', () => {
    expect(run({ mmr: '20', leverage: '10' }).risk).toBe('red')
  })
})

describe('显示精度', () => {
  it.each(['1e1000', '1'.repeat(100)])('极端字符串不会进入无限展开格式化', value => {
    expect(money(value)).toBe('—'); expect(price(value)).toBe('—'); expect(quantity(value)).toBe('—')
  })
  it('大额价格默认两位', () => expect(price('100000')).toBe('100,000.00'))
  it.each(['abc', 'NaN', 'Infinity', '-Infinity'])('格式函数对非法值 %s 安全回退', value => {
    expect(money(value)).toBe('—')
    expect(price(value)).toBe('—')
    expect(quantity(value)).toBe('—')
  })
  it('金额默认两位，极小金额不冒充零', () => {
    expect(money('2500')).toBe('2,500.00')
    expect(money('0.00001')).toBe('<0.01')
    expect(money('0')).toBe('0.00')
  })
  it('数量最多八位，极小正数提示', () => {
    expect(quantity('0.025')).toBe('0.025')
    expect(quantity('0.000000001')).toBe('<0.00000001')
  })
  it('低价不显示为零', () => expect(price('0.0000000000123')).toBe('0.0000000000123'))
})
