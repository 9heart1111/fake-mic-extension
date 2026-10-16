import { test as base, chromium, expect, type BrowserContext, type Page } from '@playwright/test'
import { resolve } from 'node:path'

export const FIXTURE_URL = 'http://127.0.0.1:4321/recorder.html'
const EXTENSION_DIR = resolve(import.meta.dirname, '..')

// 每个用例一个全新的浏览器配置目录，音频库互不影响。
export const test = base.extend<{ context: BrowserContext }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${EXTENSION_DIR}`,
        `--load-extension=${EXTENSION_DIR}`,
        // 关闭插件时走真实 getUserMedia，用 Chrome 自带的模拟设备避免权限弹窗。
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
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

export async function addClips(page: Page, clips: Array<[name: string, frequency: number, seconds: number]>) {
  await panel(page)
    .locator('input[type=file]')
    .setInputFiles(clips.map(([name, frequency, seconds]) => ({ name, mimeType: 'audio/wav', buffer: sineWav(frequency, seconds) })))
  await expect(panel(page).locator('.row')).toHaveCount(clips.length)
}

/** 等面板显示选中了指定音频段，且主世界已经加载好它。 */
export async function expectSelected(page: Page, name: string) {
  await expect(panel(page).locator('.row.sel')).toContainText(name)
  await expect(panel(page).locator('.status')).not.toContainText('加载中')
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
