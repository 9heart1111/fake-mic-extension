import { FIXTURE_URL, addClips, expect, panel, setLang, test } from './helpers'

// 面板文案来自 src/i18n.js，默认跟随浏览器界面语言（chrome.i18n.getUILanguage()）。

test.describe('英文浏览器', () => {
  test.use({ locale: 'en-US' })

  test('英文浏览器下界面是英文', async ({ page }) => {
    await page.goto(FIXTURE_URL)
    await expect(panel(page)).toHaveAttribute('data-lang', 'en')
    await expect(panel(page).locator('.title')).toHaveText('Fake Mic')
    await expect(panel(page).locator('label:has(input[data-key="enabled"])')).toHaveText('Enable fake mic')
    await expect(panel(page).locator('.empty')).toHaveText('Click “Add audio” or drop audio files here')
  })
})

test.describe('中文浏览器', () => {
  test.use({ locale: 'zh-CN' })

  test('中文浏览器下界面是中文', async ({ page }) => {
    await page.goto(FIXTURE_URL)
    await expect(panel(page)).toHaveAttribute('data-lang', 'zh')
    await expect(panel(page).locator('.title')).toHaveText('模拟麦克风')
    await expect(panel(page).locator('label:has(input[data-key="enabled"])')).toHaveText('启用模拟麦克风')
    await expect(panel(page).locator('.empty')).toHaveText('点“添加音频”或把音频文件拖到这里')
  })
})

test('可以在面板里切换语言，刷新后保持', async ({ page }) => {
  await page.goto(FIXTURE_URL)
  const title = panel(page).locator('.title')

  await setLang(page, 'zh')
  await expect(title).toHaveText('模拟麦克风')
  await expect(panel(page).locator('.play')).toHaveText('▶ 播放')

  // 语言选择存在 chrome.storage.local 里，刷新页面后仍然是中文。
  await page.reload()
  await expect(panel(page).locator('select[data-key="lang"]')).toHaveValue('zh')
  await expect(title).toHaveText('模拟麦克风')

  await setLang(page, 'en')
  await expect(title).toHaveText('Fake Mic')
  await expect(panel(page).locator('.play')).toHaveText('▶ Play')
})

test('切换语言不影响音频库和状态', async ({ page }) => {
  await page.goto(FIXTURE_URL)
  await addClips(page, [['a.wav', 440, 0.5]])

  await setLang(page, 'zh')
  await expect(panel(page).locator('.status')).toContainText('第 1/1 段')
  await expect(panel(page).locator('.row.sel')).toContainText('a.wav')

  await setLang(page, 'en')
  await expect(panel(page).locator('.status')).toContainText('Clip 1/1')
  await expect(panel(page).locator('.row.sel')).toContainText('a.wav')
})

test('主世界的提示按面板语言显示，切换语言后跟着变', async ({ page }) => {
  await page.goto(FIXTURE_URL)
  // 没有音频段时开始录音：main-world.js 只发 { type: 'warning', code: 'noClip' }，文案由面板渲染。
  await page.click('#record')
  await expect(panel(page).locator('.notice')).toHaveText('No clip selected — the recording will be silent')

  await setLang(page, 'zh')
  await expect(panel(page).locator('.notice')).toHaveText('没有选中的音频段，录到的是静音')
})

test('面板自己的提示（快捷键到头）也按当前语言显示', async ({ page }) => {
  await page.goto(FIXTURE_URL)
  await addClips(page, [['a.wav', 440, 0.5]])

  await page.keyboard.press('Alt+ArrowRight') // 只有一段，按下一段会提示已经是最后一段
  await expect(panel(page).locator('.notice')).toHaveText('Already at the last clip')

  await setLang(page, 'zh')
  await expect(panel(page).locator('.notice')).toHaveText('已经是最后一段')
})
