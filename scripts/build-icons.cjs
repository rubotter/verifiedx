const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

// 从同一份矢量源生成各尺寸图标，保持工具栏与侧栏一致。
async function main() {
  const root = path.resolve(__dirname, '..');
  const svg = await fs.readFile(path.join(root, 'assets/brand/verifiedx.svg'), 'utf8');
  const browser = await chromium.launch({ headless: true, channel: 'chromium' });
  try {
    for (const size of [16, 32, 48, 128, 512]) {
      const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: size, height: size } });
      await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
      await page.screenshot({
        path: path.join(root, size === 512 ? 'assets/brand/verifiedx.png' : `extension/icons/${size}.png`),
        omitBackground: true,
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
