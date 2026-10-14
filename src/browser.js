import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import 'dotenv/config';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const SHOTS_DIR = path.join(ROOT, 'screenshots');

/** 唯一允许的入口。任何脚本都不许直接拼深层 URL —— 只能从这里点进去。 */
export const HOME_URL = 'https://www.usvisascheduling.com/en-us/';

/**
 * 启动一个**一次性**的 Chrome 实例。
 *
 * profile 建在系统临时目录里，退出时整个删掉：
 * 不留 cookie、不留登录态、不留历史，每次运行都是干净的。
 * 代价是每次都得完整登录一遍 —— 这是有意的取舍。
 */
export async function launch() {

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visa-auto-'));

  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',            // 用本机真实 Chrome，而不是 Playwright 自带 Chromium
    headless: process.env.HEADLESS === 'true',
    viewport: null,               // 跟随真实窗口大小
    args: ['--start-maximized'],
  });

  // 无论怎么退出（正常结束、Ctrl+C、异常），都把这次的 profile 抹掉
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      // Chrome 关闭时可能仍有最后几个文件写入；对 ENOTEMPTY 做短暂重试，
      // 不让临时目录清理失败把一次成功运行误报为退出码 1。
      fs.rmSync(profileDir, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    } catch (err) {
      console.error(`  ⚠️ 临时 profile 清理失败: ${err.message}`);
    }
  };
  context.on('close', cleanup);
  process.once('exit', cleanup);
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, () => {
      cleanup();
      process.exit(1);
    });
  }

  const page = context.pages()[0] ?? (await context.newPage());
  return { context, page, profileDir };
}

/** 虚拟排队页的特征文案。命中任意一条就是在排队。 */
const QUEUE_MARKERS = [
  /You are now in line/i,
  /estimated wait time/i,
  /virtual queue/i,
  /Thank you for your patience/i,
];

/**
 * 站点会在任意一步插入 Queue-it 虚拟排队页（"You are now in line."）。
 * 它自己会定时刷新并放行，所以这里什么都不做，只是等它过去。
 *
 * 每次 goto / 点击跳转之后都该调一次。
 */
export async function waitThroughQueue(page, { maxMinutes = 45 } = {}) {
  const deadline = Date.now() + maxMinutes * 60_000;
  let announced = false;

  while (Date.now() < deadline) {
    const text = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    if (!QUEUE_MARKERS.some((re) => re.test(text))) {
      if (announced) console.log('  ✅ 已出队，继续。');
      return true;
    }

    if (!announced) {
      const eta = text.match(/estimated wait time is ([^.\n]+)/i);
      console.log(`  🚦 遇到虚拟排队页${eta ? `（预计 ${eta[1].trim()}）` : ''}，等待放行...`);
      announced = true;
    }
    // 排队页自己会刷新，这里只管等
    await page.waitForTimeout(10_000);
  }

  console.error(`  ⚠️ 排队超过 ${maxMinutes} 分钟仍未放行。`);
  return false;
}

export async function shot(page, name) {
  if (process.env.SAVE_SCREENSHOTS !== 'true') return null;
  fs.mkdirSync(SHOTS_DIR, { recursive: true, mode: 0o700 });
  const file = path.join(SHOTS_DIR, `${Date.now()}-${name}.png`);
  try {
    // 截图只是诊断记录，不应因页面字体或渲染卡住而中断主流程。
    await page.screenshot({ path: file, fullPage: true, timeout: 15_000 });
    console.log(`  📸 截图: ${file}`);
    return file;
  } catch (err) {
    console.error(`  ⚠️ 截图失败（不影响主流程）: ${err.message}`);
    return null;
  }
}

/** 等你在浏览器里手动完成某件事（过验证码等），回终端按回车继续。 */
export function waitForEnter(msg) {
  console.log(`\n⏸  ${msg}\n   处理完后回到这个终端按 [Enter] 继续...`);
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.pause();
      resolve();
    });
  });
}
