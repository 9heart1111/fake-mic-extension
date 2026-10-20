import { test as base, chromium, expect, type BrowserContext, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

export const FIXTURE_URL = 'http://127.0.0.1:4321/recorder.html'
const EXTENSION_DIR = resolve(import.meta.dirname, '..')

// Chrome 自带的模拟麦克风是每两秒一次的 440Hz 蜂鸣，用过零率估算会随窗口漂移（实测 369~433Hz），
// 断不住。给它喂一个固定音频文件后，“真实麦克风”就是稳定的 660Hz 正弦波。
export const REAL_DEVICE_TONE = 660
const REAL_DEVICE_WAV = resolve(tmpdir(), 'fake-mic-real-device.wav')
writeFileSync(REAL_DEVICE_WAV, sineWav(REAL_DEVICE_TONE, 1))

// 每个用例一个全新的浏览器配置目录，音频库互不影响。
// locale 决定界面语言（面板默认跟随 chrome.i18n.getUILanguage），固定成 en-US，避免受宿主机语言影响；
// 需要中文界面的用例用 test.use({ locale: 'zh-CN' }) 覆盖。
export const test = base.extend<{ context: BrowserContext }>({
  locale: ['en-US', { option: true }],
  context: async ({ locale }, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      locale,
      args: [
        `--disable-extensions-except=${EXTENSION_DIR}`,
        `--load-extension=${EXTENSION_DIR}`,
        // 关闭插件时走真实 getUserMedia，用 Chrome 自带的模拟设备避免权限弹窗；
        // 指定音频文件让“真实麦克风”的声音固定下来（见上面的 REAL_DEVICE_TONE）。
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        `--use-file-for-fake-audio-capture=${REAL_DEVICE_WAV}`,
      ],
    })
    await use(context)
    await context.close()
  },
  page: async ({ context }, use) => {
    await use(await context.newPage())
  },
})
export { expect }

/** 16-bit PCM 单声道正弦波 WAV。 */
export function sineWav(frequency: number, seconds: number, sampleRate = 48000): Buffer {
  const samples = Math.round(seconds * sampleRate)
  const wav = Buffer.alloc(44 + samples * 2)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + samples * 2, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++)
    wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.5 * 32767), 44 + i * 2)
  return wav
}

export const panel = (page: Page) => page.locator('fake-mic-panel')

/** 面板语言选择框，选项为 auto / zh / en。 */
export const setLang = (page: Page, lang: 'auto' | 'zh' | 'en') => panel(page).locator('select[data-key="lang"]').selectOption(lang)

/** 面板上的复选框（按 data-key 取，和界面语言无关）。 */
export const option = (page: Page, key: 'enabled' | 'monitor' | 'autoPlay' | 'autoAdvance') =>
  panel(page).locator(`input[data-key="${key}"]`)

export async function addClips(page: Page, clips: Array<[name: string, frequency: number, seconds: number]>) {
  await panel(page)
    .locator('input[type=file]')
    .setInputFiles(clips.map(([name, frequency, seconds]) => ({ name, mimeType: 'audio/wav', buffer: sineWav(frequency, seconds) })))
  await expect(panel(page).locator('.row')).toHaveCount(clips.length)
}

/** 等面板显示选中了指定音频段，且主世界已经加载好它。 */
export async function expectSelected(page: Page, name: string) {
  await expect(panel(page).locator('.row.sel')).toContainText(name)
  await expect(panel(page).locator('.status')).not.toHaveAttribute('data-loading', '1')
}

export interface RecordResult {
  label: string
  endedBeforeStop: boolean
  readyState: string
  frequency: number
  voicedSeconds: number
}

export async function record(page: Page): Promise<RecordResult> {
  const count = await page.evaluate(() => (window as any).results.length)
  await page.click('#record')
  await page.waitForFunction((n) => (window as any).results.length > n, count)
  return page.evaluate((n) => (window as any).results[n], count)
}

/** 插件自己造的音轨（Web Audio 的 MediaStreamAudioDestinationNode）；真实设备不是这个名字。 */
export const FAKE_TRACK_LABEL = 'MediaStreamAudioDestinationNode'

// ---------- 任意站点（不再只限 localhost）相关的辅助 ----------

const FIXTURE_HTML = readFileSync(resolve(import.meta.dirname, 'fixtures/recorder.html'))

/** 把 fixture 页面挂到任意 origin 下，不用真的起服务器、也不用配 DNS。 */
export async function serveFixtureOn(page: Page, origin: string) {
  await page.route(`${origin}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE_HTML }),
  )
}

const idCache = new WeakMap<BrowserContext, string>()

/** 解压加载的扩展 ID 是从路径推导的；直接问 chrome://extensions，免得复刻推导算法。 */
export async function extensionId(context: BrowserContext): Promise<string> {
  const cached = idCache.get(context)
  if (cached) return cached
  const page = await context.newPage()
  try {
    await page.goto('chrome://extensions/')
    const handle = await page.waitForFunction(() => {
      const manager = document.querySelector('extensions-manager') as any
      const list = manager?.shadowRoot?.querySelector('extensions-item-list') as any
      const item = list?.shadowRoot?.querySelector('extensions-item') as any
      return item?.getAttribute('id') || ''
    })
    const id = (await handle.jsonValue()) as string
    idCache.set(context, id)
    return id
  } finally {
    await page.close()
  }
}

/** 模拟“在工具栏弹窗里开关本站”：写 sites 白名单。 */
export async function setSites(context: BrowserContext, sites: string[]) {
  const page = await context.newPage()
  try {
    await page.goto(`chrome-extension://${await extensionId(context)}/src/popup.html`)
    await page.evaluate((next) => (globalThis as any).chrome.storage.local.set({ sites: next }), sites)
  } finally {
    await page.close()
  }
}

/** 打一个已加载插件的弹窗页面（弹窗本身没法点工具栏，测试里当成普通页面打开）。 */
export async function openPopup(context: BrowserContext): Promise<Page> {
  const id = await extensionId(context) // 取 ID 会临时开关一个标签页，先做完以免影响活动标签
  const page = await context.newPage()
  await page.goto(`chrome-extension://${id}/src/popup.html`)
  return page
}

/**
 * 在后台打开弹窗页、把 page 留在前台：模拟“点工具栏图标”时弹窗查到的当前标签就是 page。
 * 弹窗页的 JS 只在加载时读一次活动标签，所以顺序必须是 取 ID → newPage → bringToFront → goto。
 */
export async function openPopupFor(context: BrowserContext, page: Page): Promise<Page> {
  const id = await extensionId(context)
  const popup = await context.newPage()
  await page.bringToFront()
  await popup.goto(`chrome-extension://${id}/src/popup.html`)
  return popup
}
