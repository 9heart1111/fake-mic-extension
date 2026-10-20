// 生成扩展图标：icons/icon{16,32,48,128}.png
// 用 Chromium 把 SVG 渲染成 PNG，避免引入图片处理依赖。用法：npm run icons
import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const OUT = resolve(ROOT, 'icons')
const SIZES = [16, 32, 48, 128]

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" style="display:block;width:100%;height:100%">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3b8bff"/>
      <stop offset="1" stop-color="#1a66d6"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#g)"/>
  <g fill="none" stroke="#ffffff" stroke-width="9" stroke-linecap="round">
    <rect x="49" y="24" width="30" height="56" rx="15" fill="#ffffff" stroke="none"/>
    <path d="M31 61a33 33 0 0 0 66 0"/>
    <path d="M64 94v13"/>
  </g>
</svg>`

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ channel: 'chromium' })

for (const size of SIZES) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:transparent}</style>${svg}`,
  )
  await page.screenshot({ path: resolve(OUT, `icon${size}.png`), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
  await page.close()
}

// 预览图：每种尺寸放大到固定格子，方便人眼检查小尺寸下的辨识度
const DISPLAY = { 16: 96, 32: 128, 48: 144, 128: 160 }
const page = await browser.newPage({ viewport: { width: 760, height: 230 }, deviceScaleFactor: 1 })
await page.setContent(`<!doctype html><meta charset="utf-8">
<style>
  body { margin: 0; padding: 20px; display: flex; gap: 16px; align-items: flex-end;
    font: 12px -apple-system, sans-serif; background: #f6f8fa; }
  figure { margin: 0; width: 160px; text-align: center; }
  img { image-rendering: pixelated; display: block; margin: 0 auto 8px;
    background: repeating-conic-gradient(#e6e9ee 0% 25%, #ffffff 0% 50%) 50% / 16px 16px; border-radius: 6px; }
</style>
${SIZES.map((s) => `<figure><img alt="" src="data:image/png;base64,${readFileSync(resolve(OUT, `icon${s}.png`)).toString('base64')}" style="width:${DISPLAY[s]}px;height:${DISPLAY[s]}px"><figcaption>${s}px</figcaption></figure>`).join('')}`)
await page.screenshot({ path: resolve(OUT, 'preview.png') })
await browser.close()
