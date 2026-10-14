/**
 * 第一步自动化测试：打开 Chrome，访问签证预约站点，截图，然后保持窗口不关。
 * 运行: npm run open
 */
import { launch, shot, HOME_URL } from './browser.js';

const URL = HOME_URL;

const { context, page } = await launch();

console.log(`▶ 正在打开 ${URL}`);
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

// 站点是 Salesforce 站点，首屏内容常常是 JS 渲染的，给它一点时间
await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

console.log(`✅ 已加载`);


await shot(page, 'landing');

console.log('\n🖐  浏览器窗口已交给你，随便操作（过验证码、登录都行）。');
console.log('   窗口会一直开着；想关就直接关窗口，或在终端 Ctrl+C。');

// 窗口关闭时进程才退出，不主动 close，避免打断你的操作
await new Promise((resolve) => context.on('close', resolve));
console.log('👋 浏览器已关闭。');
