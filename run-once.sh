#!/bin/zsh
# 定时任务的入口：跑一轮完整流程，选完领区后把浏览器留给用户 —— 但**有时间上限**。
# 由 launchd 调用，见 examples/com.example.visa-auto.plist
#
# 为什么要有上限：launchd 靠「上一轮是否结束」来防重叠。脚本选完领区（或登录失败）后
# 会留着窗口等人来关，没人关它就永远不结束，launchd 认为任务还在跑，
# **后续每一个时刻都被跳过** —— 实际发生过三次，最长一次吃掉了整整两天。
# 加上限后，最坏情况只损失当前这一轮。
#
# 手动跑（npm run login）不走这里，仍然无限期留窗口，不受影响。
set -u

cd "$(dirname "$0")"

# 上限。起跑在 :20 / :50，25 分钟后收尾 → :15 / :45，稳稳赶在下一轮 :20 / :50 之前。
MAX_MINUTES=${MAX_MINUTES:-25}
MAX_SECONDS=${MAX_SECONDS:-$((MAX_MINUTES * 60))}

LOG_DIR="logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/$(date +%Y-%m-%d).log"

echo "===== $(date '+%Y-%m-%d %H:%M:%S %Z') 开始（上限 ${MAX_SECONDS} 秒）=====" >>"$LOG"
started=$SECONDS

timeout_flag=$(mktemp -t visa-auto-timeout)
rm -f "$timeout_flag"

# 浏览器由用户继续操作并手动关闭；超过上限则由下面的看门狗强制收尾。
KEEP_OPEN=true "${NODE_BIN:-node}" src/login.js >>"$LOG" 2>&1 &
node_pid=$!

# 看门狗。两个顺序很关键：
#  1. 先立 flag 再动手 —— 主流程 wait 一返回就要靠它判断这是超时还是正常退出。
#  2. 先杀 Chrome 再杀 node —— node 一退出，Chrome 就被 reparent 到 init，
#     那时再用 pgrep -P 找不到它，会留下孤儿 Chrome（实测确认过）。
{
  # 用绝对截止时间戳，而不是 `sleep $MAX_SECONDS` —— sleep 在系统睡眠期间不走秒，
  # 它数的是「醒着的时间」。实际踩过：Mac 下午一直 clamshell 深睡，
  # 25 分钟的上限被摊成了 188 分钟墙上时间，照样顶掉了后面六个时刻。
  # 拿 date +%s 比对绝对时间，机器一唤醒就能立刻发现已经超时。
  deadline=$(( $(date +%s) + MAX_SECONDS ))
  while (( $(date +%s) < deadline )); do sleep 20; done
  : >"$timeout_flag"
  kids=$(pgrep -P $node_pid 2>/dev/null)
  for k in ${=kids}; do kill -TERM $k 2>/dev/null; done
  kill -TERM $node_pid 2>/dev/null
  sleep 5
  for k in ${=kids}; do kill -KILL $k 2>/dev/null; done
  kill -KILL $node_pid 2>/dev/null
} &
watchdog_pid=$!

wait $node_pid
exit_code=$?

if [[ -f "$timeout_flag" ]]; then
  # 超时收尾中 —— 必须等看门狗把 Chrome 也清完，不能急着杀它，
  # 否则 node 死了、Chrome 还活着，正是我们要根治的那种残留。
  wait $watchdog_pid 2>/dev/null
  echo "⏱  已达 ${MAX_SECONDS} 秒上限，强制收尾（避免顶掉后续时刻）" >>"$LOG"
else
  kill $watchdog_pid 2>/dev/null
  wait $watchdog_pid 2>/dev/null
fi
rm -f "$timeout_flag"

elapsed=$((SECONDS - started))
echo "===== $(date '+%Y-%m-%d %H:%M:%S %Z') 结束 (exit=$exit_code, 用时 $((elapsed / 60))m$((elapsed % 60))s) =====" >>"$LOG"
exit $exit_code
