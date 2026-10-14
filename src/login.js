/**
 * 跑一次完整登录：全新 profile → 首页 → 账号密码 → 安全问题 → 改期页。
 *
 * 不复用登录态，不留任何本地记录，只从首页进。
 * 登录后就停手，不做任何预约/确认动作。
 *
 * 运行: npm run login
 */
import { launch } from './browser.js';
import {
  assertCredentials,
  performLogin,
  gotoReschedule,
  keepAliveUntil,
  nextHalfHour,
  prepareConsularPost,
  selectConsularPost,
} from './flow.js';

// ALIGN=false 时立刻选领区（手动调试用）；否则等到下一个整点/半点才选
const ALIGN = process.env.ALIGN === 'true';

assertCredentials();

const { context, page } = await launch();
let succeeded = true;

// 整个流程包一层兜底：Playwright 的任何一处超时都会抛，未捕获就会杀掉 node 进程、
// 连带关掉浏览器窗口 —— 那样一轮已经登录成功的运行会白白报废（实际发生过）。
// 兜住之后，窗口按 KEEP_OPEN 的约定留着，定时任务那边有看门狗负责收尾。
try {
  const login = await performLogin(page);
  if (!login.ok) {
    succeeded = false;
    console.error(`❌ 登录未完成：${login.detail}`);
    console.error('   窗口保持打开，请你手动处理这一次（脚本不会自动重试）。');
  } else {
    console.log(`✅ 登录成功。当前地址: ${login.detail}`);
    const resched = await gotoReschedule(page);
    if (!resched.ok) {
      succeeded = false;
      console.error(`⚠️ ${resched.detail}`);
    } else {
      console.log(`   已进入改期页: ${resched.detail}`);

      // 卡点：到点前 2 分钟预先锁定目标领区选项，到整点/半点只发选择动作。
      const preparedPost = ALIGN
        ? await keepAliveUntil(page, nextHalfHour(), {
            onSettled: () => prepareConsularPost(page),
          })
        : await prepareConsularPost(page);

      const post = await selectConsularPost(page, preparedPost);
      if (!post.ok) succeeded = false;
      console.log(post.ok ? `✅ 已选好领区: ${post.detail}` : `⚠️ ${post.detail}`);
    }
  }
} catch (err) {
  succeeded = false;
  console.error(`❌ 流程中断（未预期的异常）：${err?.message ?? err}`);
  console.error('   窗口保持打开；定时任务会由 run-once.sh 的看门狗到点收尾。');
}

console.log('\n🛑 脚本到此为止 —— 不会进行任何预约或确认操作。');

// 定时运行时必须自己关掉，否则下一轮起不来；手动跑时留着窗口给你看
if (process.env.KEEP_OPEN === 'false') {
  await context.close();
  console.log('👋 已关闭浏览器，本次 profile 已删除。');
} else {
  console.log('🖐  浏览器窗口留给你，关窗口即退出（本次 profile 会被删除）。');
  await new Promise((resolve) => {
    let finished = false;
    const finish = async () => {
      if (finished) return;
      finished = true;
      await context.close().catch(() => {});
      resolve();
    };

    // macOS Chrome 可能在最后一个窗口关闭后仍保留后台进程。
    // 同时监听页面和 context，确保用户关窗口后本轮真正结束。
    page.once('close', finish);
    context.once('close', finish);
  });
}

if (!succeeded) process.exitCode = 1;
