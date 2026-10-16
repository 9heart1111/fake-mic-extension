import { FIXTURE_URL, addClips, expect, expectSelected, panel, record, test } from './helpers'

const A = 440
const B = 880

test('录到当前选中的音频段，音频放完后音轨仍然在线', async ({ page }) => {
  await page.goto(FIXTURE_URL)
  await addClips(page, [['a.wav', A, 0.5]])
  await expectSelected(page, 'a.wav')

  const result = await record(page) // 录 1.5 秒，长于 0.5 秒的音频段
  expect(result.frequency).toBeGreaterThan(A * 0.9)
  expect(result.frequency).toBeLessThan(A * 1.1)
  expect(result.endedBeforeStop).toBe(false)
  expect(result.readyState).toBe('live')
})

test('录完自动切到下一段，下一轮录到的是新段落', async ({ page }) => {
  await page.goto(FIXTURE_URL)
  await addClips(page, [
    ['a.wav', A, 0.5],
    ['b.wav', B, 0.5],
  ])
  await expectSelected(page, 'a.wav')
  expect((await record(page)).frequency).toBeLessThan(A * 1.1)

  await expectSelected(page, 'b.wav')
  const second = await record(page)
  expect(second.frequency).toBeGreaterThan(B * 0.9)
  expect(second.frequency).toBeLessThan(B * 1.1)
})

test('关闭插件后页面拿到的是真实麦克风', async ({ page }) => {
  await page.goto(`${FIXTURE_URL}?ms=600`)
  await addClips(page, [['a.wav', A, 0.5]])
  await panel(page).getByLabel('录完切到下一段').uncheck()
  await expectSelected(page, 'a.wav')
  const fake = await record(page)

  await panel(page).getByLabel('启用模拟麦克风').uncheck()
  const real = await record(page)
  expect(real.label).not.toBe(fake.label)
  expect(Math.abs(real.frequency - A)).toBeGreaterThan(A * 0.1)
})
