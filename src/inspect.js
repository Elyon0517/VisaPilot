/** 输出当前页面输入框和按钮的选择器。运行：node src/inspect.js。 */
import { launch, shot, HOME_URL } from './browser.js';

const URL = HOME_URL;
const { context, page } = await launch();

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

const dump = await page.evaluate(() => {
  const desc = (el) => ({
    tag: el.tagName.toLowerCase(),
    type: el.type || null,
    id: el.id || null,
    name: el.getAttribute('name'),
    placeholder: el.getAttribute('placeholder'),
    ariaLabel: el.getAttribute('aria-label'),
    text: el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? null : (el.innerText || '').trim().slice(0, 40) || null,
    visible: !!(el.offsetWidth || el.offsetHeight),
  });
  return {
    origin: location.origin,
    fields: [...document.querySelectorAll('input, select, textarea')].map(desc),
    buttons: [...document.querySelectorAll('button, input[type=submit], a[role=button]')].map(desc),
  };
});

console.log(JSON.stringify(dump, null, 2));
await shot(page, 'inspect');
await context.close();
