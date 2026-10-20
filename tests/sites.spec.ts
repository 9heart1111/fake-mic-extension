import {
  FAKE_TRACK_LABEL,
  FIXTURE_URL,
  REAL_DEVICE_TONE,
  addClips,
  extensionId,
  expect,
  expectSelected,
  openPopup,
  openPopupFor,
  panel,
  record,
  serveFixtureOn,
  setSites,
  test,
} from './helpers'

// 插件现在注入所有 http/https 站点，但只在 localhost / 127.0.0.1（始终）和弹窗里手动启用的站点上生效。
const SITE = 'https://example.test'
const CLIP_TONE = 880 // 插件喂的音频段，和真实设备（REAL_DEVICE_TONE）区分开

test('非本地站点默认不生效：不注入面板，拿到的是真实麦克风', async ({ page }) => {
  await serveFixtureOn(page, SITE)
  await page.goto(`${SITE}/recorder.html`)
  await expect(panel(page)).toHaveCount(0)

  const result = await record(page)
  expect(result.label).not.toBe(FAKE_TRACK_LABEL)
  expect(result.frequency).toBeGreaterThan(REAL_DEVICE_TONE * 0.9)
  expect(result.frequency).toBeLessThan(REAL_DEVICE_TONE * 1.1)
  expect(result.voicedSeconds).toBeGreaterThan(0.5)
})

test('弹窗里启用后，已经打开的页面立即生效（不用刷新）', async ({ page, context }) => {
  await serveFixtureOn(page, SITE)
  await page.goto(`${SITE}/recorder.html`)
  await expect(panel(page)).toHaveCount(0)

  await setSites(context, [SITE]) // = 在工具栏弹窗里打开“在此站点启用”
  await expect(panel(page)).toHaveCount(1)

  await addClips(page, [['b.wav', CLIP_TONE, 0.5]])
  await expectSelected(page, 'b.wav')
  const result = await record(page)
  expect(result.frequency).toBeGreaterThan(CLIP_TONE * 0.9)
  expect(result.frequency).toBeLessThan(CLIP_TONE * 1.1)
})

test('关掉本站开关后，面板消失并恢复真实麦克风', async ({ page, context }) => {
  await setSites(context, [SITE])
  await serveFixtureOn(page, SITE)
  await page.goto(`${SITE}/recorder.html`)
  await expect(panel(page)).toHaveCount(1)

  await setSites(context, [])
  await expect(panel(page)).toHaveCount(0)

  const result = await record(page)
  expect(result.label).not.toBe(FAKE_TRACK_LABEL)
  expect(result.frequency).toBeLessThan(CLIP_TONE * 0.9)
  expect(result.frequency).toBeGreaterThan(REAL_DEVICE_TONE * 0.9)
})

test('弹窗能读到当前站点 URL，并按站点写入白名单', async ({ context }) => {
  const site = await context.newPage()
  await serveFixtureOn(site, SITE)
  await site.goto(`${SITE}/recorder.html`)

  const popup = await openPopup(context)
  await site.bringToFront() // 让弹窗查询到的是被测站点，而不是弹窗自己
  const tab = await popup.evaluate(async () => {
    const [active] = await (globalThis as any).chrome.tabs.query({ active: true, currentWindow: true })
    return active?.url ?? ''
  })
  expect(tab).toBe(`${SITE}/recorder.html`)

  // 弹窗拿到的 origin 与 panel.js 的白名单判断用的是同一个值
  await popup.evaluate(() => (globalThis as any).chrome.storage.local.set({ sites: ['https://example.test'] }))
  const stored = await popup.evaluate(() => (globalThis as any).chrome.storage.local.get('sites'))
  expect(stored.sites).toEqual(['https://example.test'])
  expect(await extensionId(context)).toMatch(/^[a-p]{32}$/)
})

test('未启用的站点收不到音频数据，启用后才下发', async ({ page, context }) => {
  // 先在 localhost 里准备好音频段（音频库全局共享），并让它保持选中
  await page.goto(FIXTURE_URL)
  await addClips(page, [['a.wav', CLIP_TONE, 0.5]])

  // 页面自己能监听 window 上的 postMessage，所以未启用的站点不该收到音频数据
  const site = await context.newPage()
  await site.addInitScript(() => {
    ;(window as any).__messages = []
    window.addEventListener('message', (event) => {
      const message = event.data
      if (message?.__fakeMic === 'toMain')
        (window as any).__messages.push({ type: message.type, hasAudio: Boolean(message.data), active: message.active })
    })
  })
  await serveFixtureOn(site, SITE)
  await site.goto(`${SITE}/recorder.html`)
  await site.waitForTimeout(500)

  const before = await site.evaluate(() => (window as any).__messages as any[])
  expect(before.some((m) => m.type === 'clip' && m.hasAudio)).toBe(false)
  expect(before.some((m) => m.type === 'settings' && m.active === false)).toBe(true)

  await setSites(context, [SITE])
  await expect(panel(site)).toHaveCount(1)
  await expect
    .poll(() => site.evaluate(() => ((window as any).__messages as any[]).some((m) => m.type === 'clip' && m.hasAudio)))
    .toBe(true)
})

test('真实弹窗：勾选「在此站点启用」后站点立即生效', async ({ page, context }) => {
  await serveFixtureOn(page, SITE)
  await page.goto(`${SITE}/recorder.html`)
  await expect(panel(page)).toHaveCount(0)

  const popup = await openPopupFor(context, page)
  await expect(popup.locator('#site')).toHaveText(`Current site: ${SITE}`)
  await expect(popup.locator('#toggle')).not.toBeChecked()

  await popup.locator('#toggle').check()
  await expect(popup.locator('#hint')).toHaveText('Enabled on this site')
  await expect(panel(page)).toHaveCount(1) // 不用刷新页面

  await popup.locator('#toggle').uncheck()
  await expect(panel(page)).toHaveCount(0)
})

test('弹窗在不可注入的页面（chrome://、扩展页）上给出提示', async ({ context }) => {
  const popup = await openPopup(context)
  await expect(popup.locator('#title')).toHaveText('Fake Mic')
  await expect(popup.locator('#site')).toContainText('Not available on this page')
  await expect(popup.locator('#toggle-row')).toBeHidden()
})
