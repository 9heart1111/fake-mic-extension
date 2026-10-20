// 生成 README 用的界面截图：docs/screenshots/*.png
// 用法：npm run screenshots（需要先 npx playwright install chromium）
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const OUT = resolve(ROOT, 'docs/screenshots')
const DEMO_URL = 'http://127.0.0.1:4321/demo.html'
const STAGING_URL = 'https://staging.example.com/demo.html'

// 16-bit PCM 单声道正弦波
function sineWav(frequency, seconds, sampleRate = 48000) {
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

// 截图用的背景页：一块干净的渐变，面板浮在上面
const demoHtml = (autoRecord) => `<!doctype html>
<meta charset="utf-8">
<title>Recording test</title>
<style>
  html, body { height: 100%; margin: 0;
    background: linear-gradient(180deg, #f6f8fa 0%, #eaeef2 100%); }
  @media (prefers-color-scheme: dark) {
    html, body { background: linear-gradient(180deg, #0d1117 0%, #161b22 100%); }
  }
</style>
${
  autoRecord
    ? `<script>
        // 让截图里能看到“录音中 + 自动播放”的真实状态
        setTimeout(async () => {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
          const recorder = new MediaRecorder(stream)
          recorder.start()
        }, 600)
      </script>`
    : ''
}`

const CLIPS = [
  ['answer-1.wav', 2.4],
  ['answer-2.wav', 5.1],
  ['answer-3.wav', 3.2],
]

async function launch(locale, colorScheme) {
  return chromium.launchPersistentContext('', {
    channel: 'chromium',
    locale,
    colorScheme,
    deviceScaleFactor: 2,
    viewport: { width: 900, height: 640 },
    args: [
      `--disable-extensions-except=${ROOT}`,
      `--load-extension=${ROOT}`,
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  })
}

async function extensionId(context) {
  const page = await context.newPage()
  try {
    await page.goto('chrome://extensions/')
    const handle = await page.waitForFunction(() => {
      const manager = document.querySelector('extensions-manager')
      const list = manager?.shadowRoot?.querySelector('extensions-item-list')
      return list?.shadowRoot?.querySelector('extensions-item')?.getAttribute('id') || ''
    })
    return await handle.jsonValue()
  } finally {
    await page.close()
  }
}

/** 把面板挪到离边角远一点的位置，截图留白才不会被视口裁掉。 */
async function seedPanelPosition(context) {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${await extensionId(context)}/src/popup.html`)
  await page.evaluate(() => chrome.storage.local.set({ ui: { lang: 'auto', collapsed: false, left: 40, top: 40 } }))
  await page.close()
}

async function demoPage(context, url, autoRecord = false) {
  const page = await context.newPage()
  await page.route(`${new URL(url).origin}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: demoHtml(autoRecord) }),
  )
  await page.goto(url)
  return page
}

async function panelShot({ locale, colorScheme, file, recording = false }) {
  const context = await launch(locale, colorScheme)
  try {
    await seedPanelPosition(context)
    const page = await demoPage(context, DEMO_URL, recording)
    const panel = page.locator('fake-mic-panel')
    await panel
      .locator('input[type=file]')
      .setInputFiles(CLIPS.map(([name, seconds]) => ({ name, mimeType: 'audio/wav', buffer: sineWav(440, seconds) })))
    await panel.locator('.row').nth(1).click() // 选中第 2 段，截图里能看到选中态
    await page.waitForTimeout(recording ? 1200 : 600)

    const box = await panel.locator('.panel').boundingBox()
    const margin = 20
    await page.screenshot({
      path: resolve(OUT, file),
      clip: { x: box.x - margin, y: box.y - margin, width: box.width + margin * 2, height: box.height + margin * 2 },
    })
  } finally {
    await context.close()
  }
}

async function popupShot({ locale, colorScheme, file }) {
  const context = await launch(locale, colorScheme)
  try {
    const id = await extensionId(context)
    const site = await demoPage(context, STAGING_URL)
    const popup = await context.newPage()
    await site.bringToFront()
    await popup.setViewportSize({ width: 360, height: 320 })
    await popup.goto(`chrome-extension://${id}/src/popup.html`)
    await popup.waitForTimeout(300)
    await popup.locator('body').screenshot({ path: resolve(OUT, file) })
  } finally {
    await context.close()
  }
}

mkdirSync(OUT, { recursive: true })
await panelShot({ locale: 'en-US', colorScheme: 'light', file: 'panel-en-light.png' })
await panelShot({ locale: 'zh-CN', colorScheme: 'light', file: 'panel-zh-light.png' })
await panelShot({ locale: 'zh-CN', colorScheme: 'dark', file: 'panel-zh-dark.png', recording: true })
await popupShot({ locale: 'en-US', colorScheme: 'light', file: 'popup-en-light.png' })
await popupShot({ locale: 'zh-CN', colorScheme: 'dark', file: 'popup-zh-dark.png' })
console.log(`screenshots -> ${OUT}`)
