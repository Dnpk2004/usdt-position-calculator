import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import App from './App.vue'

let wrapper: VueWrapper
beforeEach(() => { localStorage.clear(); wrapper = mount(App) })
afterEach(() => { wrapper.unmount(); vi.unstubAllGlobals() })
async function fill() {
  await wrapper.get('#entry').setValue('100000')
  await wrapper.get('#stop').setValue('98000')
}
describe('页面使用同一核心计算数据', () => {
  it('没有开仓价时非法全仓余额也不会崩溃', async () => {
    await wrapper.get('[data-testid="cross"]').trigger('click')
    await wrapper.get('#wallet').setValue('abc')
    expect(wrapper.get('[data-testid="notional"]').text()).toBe('—')
  })
  it('起始显示空结果，不暗示实时行情', () => {
    expect(wrapper.get('[data-testid="notional"]').text()).toBe('—')
    expect(wrapper.text()).toContain('手动价格')
  })
  it('输入立即显示仓位、数量、保证金和止盈比', async () => {
    await fill(); await wrapper.get('#take').setValue('104000')
    expect(wrapper.get('[data-testid="notional"]').text()).toBe('2,500.00')
    expect(wrapper.get('[data-testid="quantity"]').text()).toBe('0.025')
    expect(wrapper.get('[data-testid="margin"]').text()).toContain('250.00')
    expect(wrapper.get('[data-testid="ratio"]').text()).toContain('2')
  })
  it('方向切换与百分比输入同步', async () => {
    await fill(); await wrapper.get('[data-testid="short"]').trigger('click')
    expect((wrapper.get('#stop').element as HTMLInputElement).value).toBe('102000')
    await wrapper.get('#stopPercent').setValue('3')
    expect((wrapper.get('#stop').element as HTMLInputElement).value).toBe('103000')
  })
  it('全仓隐藏逐仓推荐，缺少余额风险为灰', async () => {
    await fill(); await wrapper.get('[data-testid="cross"]').trigger('click')
    expect(wrapper.find('#wallet').exists()).toBe(true)
    expect(wrapper.find('[data-testid="apply-conservative"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="risk"]').attributes('data-state')).toBe('gray')
    await wrapper.get('#wallet').setValue('100')
    expect(wrapper.text()).toContain('余额不足')
  })
  it('推荐按钮应用核心计算的 28 倍', async () => {
    await fill(); await wrapper.get('[data-testid="apply-conservative"]').trigger('click')
    expect((wrapper.get('#leverage').element as HTMLInputElement).value).toBe('28')
    expect(wrapper.get('[data-testid="risk"]').attributes('data-state')).toBe('green')
  })
  it('无效价格有中文错误且没有旧结果', async () => {
    await fill(); await wrapper.get('#entry').setValue('0')
    expect(wrapper.get('[data-testid="notional"]').text()).toBe('—')
    expect(wrapper.text()).toContain('开仓价须为有效正数')
  })
  it('币种按钮清空价格和结果', async () => {
    await fill(); await wrapper.get('[data-testid="symbol-ETH"]').trigger('click')
    expect((wrapper.get('#entry').element as HTMLInputElement).value).toBe('')
    expect(wrapper.get('[data-testid="notional"]').text()).toBe('—')
    expect(wrapper.text()).toContain('ETHUSDT')
  })
  it('独立复制原始数值，无千分位或单位', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await fill(); await wrapper.get('[data-testid="copy-notional"]').trigger('click')
    await wrapper.get('[data-testid="copy-quantity"]').trigger('click')
    expect(writeText.mock.calls).toEqual([['2500'], ['0.025']])
  })
  it('刷新恢复和重置', async () => {
    await fill(); wrapper.unmount(); wrapper = mount(App)
    expect(wrapper.get('[data-testid="notional"]').text()).toBe('2,500.00')
    await wrapper.get('[data-testid="reset"]').trigger('click')
    expect(wrapper.get('[data-testid="notional"]').text()).toBe('—')
    expect((wrapper.get('#risk').element as HTMLInputElement).value).toBe('50')
  })
})
