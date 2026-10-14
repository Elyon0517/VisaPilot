/**
 * 登录流程的共用实现。login.js 都走这里。
 *
 * 硬规则：
 *   - 只访问 HOME_URL，深层页面一律靠点击进入，绝不直接拼 URL
 *   - 只登录、只读页面，不点任何预约/确认/提交
 */
import { shot, waitThroughQueue, HOME_URL } from './browser.js';

const EMAIL = process.env.VISA_EMAIL;
const PASSWORD = process.env.VISA_PASSWORD;

// B2C 登录页选择器（已对线上页面核实）
const SEL = {
  user: '#signInName',
  pass: '#password',
  submit: '#continue',
  error: '.error.pageLevel, .error.itemLevel',
};

// Account-specific field IDs and answers belong only in the local .env file.
let KBA_ANSWERS;
try {
  KBA_ANSWERS = JSON.parse(process.env.VISA_SECURITY_ANSWERS || '{}');
  if (!KBA_ANSWERS || Array.isArray(KBA_ANSWERS) || typeof KBA_ANSWERS !== 'object' ||
      Object.values(KBA_ANSWERS).some((value) => typeof value !== 'string')) throw new Error();
} catch {
  throw new Error('VISA_SECURITY_ANSWERS must be a JSON object of field IDs to string answers.');
}
const CONSULAR_POST = process.env.VISA_CONSULAR_POST?.trim();

export function assertCredentials() {
  if (!EMAIL || !PASSWORD || !CONSULAR_POST) {
    console.error('❌ 缺少 VISA_EMAIL / VISA_PASSWORD / VISA_CONSULAR_POST。请复制 .env.example 为 .env 并填写。');
    process.exit(1);
  }
}

/**
 * 从首页走完整登录。
 * @returns {Promise<{ok: boolean, detail: string}>}
 */
export async function performLogin(page) {
  console.log(`▶ 打开 ${HOME_URL}（全新 profile，无任何历史）`);
  await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  if (!(await waitThroughQueue(page))) {
    await shot(page, 'queue-timeout');
    return { ok: false, detail: '首页排队超过 45 分钟，未继续登录' };
  }

  // Cloudflare 有时会要求用户手动点击人机验证。定时任务提前 15 分钟启动，
  // 这里留 10 分钟给用户处理；只等待放行，不自动点击或绕过验证。
  console.log('▶ 等待登录页（如出现 Cloudflare，请在 10 分钟内手动完成验证）');
  const onLoginPage = await page
    .locator(SEL.user)
    .waitFor({ state: 'visible', timeout: 10 * 60_000 })
    .then(() => true)
    .catch(() => false);

  if (!onLoginPage) {
    await shot(page, 'no-login-page');
    return { ok: false, detail: `10 分钟内没等到登录页，当前在 [地址已隐藏]` };
  }

  console.log('▶ 填写登录表单');
  await page.fill(SEL.user, EMAIL);
  await page.fill(SEL.pass, PASSWORD);
  await page.click(SEL.submit);
  console.log('▶ 已提交账号密码，等待下一步...');

  const kba = await handleSecurityQuestions(page);
  if (!kba.ok) return kba;

  await page
    .waitForURL((u) => !u.hostname.includes('b2clogin.com'), { timeout: 60_000 })
    .catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  if (!(await waitThroughQueue(page))) {
    await shot(page, 'queue-timeout');
    return { ok: false, detail: '登录后排队超过 45 分钟，未继续操作' };
  }

  if (page.url().includes('b2clogin.com')) {
    
    await shot(page, 'login-failed');
    return { ok: false, detail: '仍停留在登录页，请在浏览器中检查错误' };
  }

  await shot(page, 'logged-in');
  return { ok: true, detail: '页面已就绪' };
}

/**
 * 处理密码之后的安全问题页。页面没出现就直接跳过。
 * 认不出字段时不猜、不提交 —— 空提交会白白消耗一次登录尝试。
 */
async function handleSecurityQuestions(page) {
  const appeared = await page
    .locator('text=/Security Question/i')
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false);

  if (!appeared) return { ok: true, detail: '没有安全问题页' };

  console.log('▶ 出现安全问题页，正在识别题目...');

  const fields = await page.evaluate(() => {
    // 答案框是 type=password（KBA 做了遮挡），所以不能只找 type=text
    return [...document.querySelectorAll('input')]
      .filter(
        (el) =>
          (el.offsetWidth || el.offsetHeight) &&
          !el.readOnly &&
          !el.disabled &&
          !['hidden', 'submit', 'button', 'checkbox', 'radio'].includes(el.type) &&
          el.id !== 'signInName' &&
          el.id !== 'password'
      )
      .map((el) => el.id || null);
  });

  console.log(`  识别到 ${fields.length} 个待填字段: ${fields.join(', ')}`);

  if (fields.length === 0) {
    await shot(page, 'security-questions-unknown');
    return { ok: false, detail: '没识别出任何答案输入框，未提交' };
  }

  let filled = 0;
  for (const id of fields) {
    const answer = KBA_ANSWERS[id];
    if (!answer) {
      console.error(`  ⚠️ ${id} 没有对应答案（题库里出现了新题，或 .env 没填）`);
      continue;
    }
    await page.locator('input').evaluateAll((els, { id, answer }) => {
      const el = els.find((item) => item.id === id);
      if (!el) throw new Error('Security answer field disappeared');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, answer);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, { id, answer });
    console.log(`  ✓ 已填 ${id}`);
    filled += 1;
  }

  if (filled !== fields.length) {
    await shot(page, 'security-questions');
    return { ok: false, detail: '有题目没能自动填好，未提交' };
  }

  // 填完先停 15 秒再提交（提交太快会被页面判成缺字段）
  console.log('  ⏳ 答案已填好，等待 15 秒后再点 Continue...');
  await page.waitForTimeout(15_000);
  await page.click(SEL.submit);
  console.log('▶ 安全问题已提交，等待跳转...');

  return { ok: true, detail: '安全问题已通过' };
}

/**
 * 登录后首页停 30 秒，然后点菜单里的 Reschedule Appointment。
 * 只点这个链接 —— 页面上任何 Submit / 确认都不碰。
 */
export async function gotoReschedule(page, { wait = true } = {}) {
  if (wait) {
    console.log('\n⏳ 已在登录后首页，等待 30 秒...');
    await page.waitForTimeout(30_000);
  }

  const link = page.getByRole('link', { name: /Reschedule Appointment/i }).first();
  const found = await link
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);

  if (!found) {
    await shot(page, 'no-reschedule-link');
    return { ok: false, detail: '没找到 Reschedule Appointment 入口' };
  }

  console.log('▶ 点击 Reschedule Appointment');
  await link.click();
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  if (!(await waitThroughQueue(page))) {
    await shot(page, 'queue-timeout');
    return { ok: false, detail: '进入改期页时排队超过 45 分钟' };
  }

  if (wait) await shot(page, 'reschedule');
  return { ok: true, detail: '页面已就绪' };
}

/** 下一个整点或半点。用来把"选目标领区"这一步对齐到 :00 / :30。 */
export function nextHalfHour(now = new Date()) {
  const t = new Date(now);
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() < 30 ? 30 : 60);
  return t;
}

/**
 * 在改期页上待命，直到 target 时刻。
 *
 * 站点会因长时间无操作自动登出，所以中途用面包屑来回跳一下：
 * Reschedule → Visa Application Home → Reschedule。
 * 这是纯导航，没有任何提交动作。
 *
 * 收尾前 2 分钟停止跳转，确保到点时已经稳稳停在改期页上。
 */
export async function keepAliveUntil(
  page,
  target,
  { everyMs = 7 * 60_000, onSettled = null } = {}
) {
  const SETTLE_MS = 2 * 60_000;
  const FINAL_ENTRY_LEAD_MS = 5 * 60_000;
  const fmt = (d) => d.toLocaleTimeString('zh-CN', { hour12: false });

  console.log(`\n⏳ 在改期页待命，目标时刻 ${fmt(target)}`);

  while (true) {
    const left = target.getTime() - Date.now();
    if (left <= FINAL_ENTRY_LEAD_MS) break;

    const sleep = Math.min(everyMs, left - FINAL_ENTRY_LEAD_MS);
    console.log(`  💤 等待 ${Math.round(sleep / 60_000)} 分钟后做一次保活跳转...`);
    await page.waitForTimeout(sleep);

    if (target.getTime() - Date.now() <= FINAL_ENTRY_LEAD_MS) break;

    const bounced = await bounce(page);
    console.log(bounced ? `  🔄 ${fmt(new Date())} 保活跳转完成` : '  ⚠️ 保活跳转失败，继续等待');
  }

  // 在 :25 / :55 开始最后一次面包屑往返，通常会在该时刻之后重新进入改期页。
  // 如果登录太晚、离目标已不足 2 分钟，则不再跳转，避免错过目标时刻。
  if (target.getTime() - Date.now() > SETTLE_MS) {
    console.log(`  🎯 ${fmt(new Date())} 开始最后一次进入 Reschedule Appointment`);
    const bounced = await bounce(page);
    console.log(
      bounced
        ? `  ✅ ${fmt(new Date())} 已完成最后一次进入 Reschedule Appointment`
        : '  ⚠️ 最后一次进入 Reschedule Appointment 失败'
    );
  }

  // 最后一次进入后预先锁定下拉框和目标领区选项，
  // 让目标时刻只需发出选择动作，不再做 DOM 查找。
  const settledValue = onSettled ? await onSettled() : undefined;

  const left = target.getTime() - Date.now();
  if (left > 0) {
    console.log(`  ⏱  ${Math.round(left / 1000)} 秒后到点，静候...`);
    await page.waitForTimeout(left);
  }
  console.log(`  ⏰ ${fmt(new Date())} 到点。`);
  return settledValue;
}

/**
 * 面包屑来回跳一次，回到改期页。纯导航。
 *
 * **整个函数不许抛异常** —— 保活跳转只是锦上添花，失败了应该让调用方留在原地继续等，
 * 而不是把整轮拖垮。实际踩过：`home.click()` 在「点了但站点不跳转」时抛
 * TimeoutError，未捕获直接崩掉 node，一轮已经登录成功、已站上改期页的运行就此报废。
 */
async function bounce(page) {
  try {
    const home = page.getByRole('link', { name: /Visa Application Home/i }).first();
    if (!(await home.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false))) {
      return false;
    }
    // 站点有时点了不跳转，click 会一直等「scheduled navigations」直到超时才抛
    await home.click({ timeout: 30_000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await waitThroughQueue(page);

    const back = await gotoReschedule(page, { wait: false });
    return back.ok;
  } catch (err) {
    console.log(`  ⚠️ 保活跳转异常（已忽略）: ${err?.message ?? err}`);
    return false;
  }
}

/**
 * 改期页上选 Consular Posts —— 默认只有 配置的领区 一项。
 * 流程到此为止：不选申请人、不点 Submit、不做任何改期动作。
 */
export async function prepareConsularPost(page) {
  const selects = page.locator('select:visible');
  const found = await selects
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 })
    .then(() => true)
    .catch(() => false);

  if (!found) {
    await shot(page, 'no-post-select');
    return { ok: false, detail: '改期页上没出现 Consular Posts 下拉框' };
  }

  let select = null;
  let target = null;
  for (let i = 0; i < (await selects.count()); i += 1) {
    const candidate = selects.nth(i);
    const options = await candidate.locator('option').evaluateAll((els) =>
      els.map((el) => ({ value: el.value, label: el.innerText.trim() }))
    );
    console.log(`  下拉框 ${i + 1} 选项: ${options.map((o) => `"${o.label}"`).join(', ') || '(空)'}`);
    const matchingPost = options.find((o) => o.value && o.label === CONSULAR_POST);
    if (matchingPost) {
      select = candidate;
      target = matchingPost;
      break;
    }
  }

  // design 要求只选目标领区；页面变化时宁可停手，不猜测其他领区。
  if (!select || !target) {
    await shot(page, 'post-no-options');
    return { ok: false, detail: '所有下拉框里都没有 配置的领区，未选择其他领区' };
  }

  console.log(`  🎯 已预先锁定 "${target.label}"，等待目标时刻`);
  return { ok: true, select, target };
}

export async function selectConsularPost(page, prepared = null) {
  const selection = prepared ?? (await prepareConsularPost(page));
  if (!selection.ok) return selection;

  const { select, target } = selection;
  const dispatchedAt = new Date();
  const precise = dispatchedAt.toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });

  console.log(`▶ ${precise} 发出选择 "${target.label}"`);
  await select.selectOption(target.value);
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  if (!(await waitThroughQueue(page))) {
    await shot(page, 'queue-timeout');
    return { ok: false, detail: '选择目标领区后排队超过 45 分钟' };
  }
  await page.waitForTimeout(3_000);

  await shot(page, 'post-selected');
  return { ok: true, detail: target.label };
}
