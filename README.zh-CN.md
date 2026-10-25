<div align="center">

# VisaPilot

**本地配置。独立会话。后续由你接手。**

基于 Playwright 的签证预约页面自动化框架，支持用户手动接管浏览器。

**[English](README.md) · 简体中文**

[![Node.js](https://img.shields.io/badge/node-20%2B-339933)](https://nodejs.org/) [![Playwright](https://img.shields.io/badge/browser-Playwright-2EAD33)](package.json) [![Version](https://img.shields.io/badge/version-0.1.0-indigo)](package.json) [![Status](https://img.shields.io/badge/status-experimental-orange)](#当前限制) [![Stars](https://img.shields.io/github/stars/Elyon0517/VisaPilot?style=flat)](https://github.com/Elyon0517/VisaPilot/stargazers)

**觉得有帮助？欢迎 [点个 Star ⭐](https://github.com/Elyon0517/VisaPilot/stargazers)**

[快速开始](#快速开始) · [配置](#配置) · [使用](#使用) · [定时运行](#macos-定时运行) · [隐私](#隐私) · [参与贡献](#参与贡献)

</div>

```mermaid
flowchart LR
    A[本地配置] --> B[临时 Chrome 会话]
    B --> C[登录与安全问题]
    C --> D[改期页面]
    D --> E[选择配置的领区]
    E --> F[用户手动接管]
```

## 功能

- 每轮使用全新的临时 Chrome 配置，从预约网站首页进入。
- 从本地配置读取账号密码，每轮只尝试一次登录。
- 按用户配置填写安全问题，等待虚拟排队；人机验证由用户手动完成。
- 进入 Reschedule Appointment 页面，选择配置中指定的领区。
- 可选等待下一个整点或半点，并通过页面导航保活。
- 选完领区后交给用户，不选择申请人、不提交预约、不确认改期。

本项目为独立社区项目，与政府或预约平台无关联。请在网站规则和账号限制允许的范围内使用。

## 快速开始

安装 Node.js 20+ 和 Google Chrome，然后执行：

```sh
git clone https://github.com/Elyon0517/VisaPilot.git
cd VisaPilot
npm ci
cp .env.example .env
```

## 配置

在本地编辑 `.env`：

| 变量 | 用途 | 默认值 |
| --- | --- | --- |
| `VISA_EMAIL` | 登录账号 | 空 |
| `VISA_PASSWORD` | 登录密码 | 空 |
| `VISA_SECURITY_ANSWERS` | 安全问题输入框 ID 与答案的 JSON 映射 | `{}` |
| `VISA_CONSULAR_POST` | 目标领区选项的完整可见文字 | 空 |
| `HEADLESS` | 隐藏浏览器窗口 | `false` |
| `ALIGN` | 等待本机时区的下一个整点或半点 | `false` |
| `KEEP_OPEN` | 流程结束后保留窗口 | `true` |
| `SAVE_SCREENSHOTS` | 保存本地诊断截图 | `false` |

安全问题字段 ID 需要根据自己的账号在本地确认，仓库不包含个人题目或答案。格式示例：

```dotenv
VISA_SECURITY_ANSWERS='{"your_field_id":"your_local_answer"}'
```

配置账号可能出现的所有答案字段。遇到未知或未配置的字段，流程会在提交前停止。

## 使用

```sh
npm run open        # 只打开首页，供手动操作
npm run login       # 执行一轮已配置的流程
npm run check       # 检查 JavaScript 语法，不访问网站
node src/inspect.js # 检查公共页面字段元数据，不输出输入框的值
```

手动登录流程在关闭浏览器窗口后结束。浏览器关闭时会尝试删除临时配置目录；强制终止或系统故障可能留下临时文件。

## macOS 定时运行

`run-once.sh` 默认在 25 分钟后结束本轮任务，使用墙上时间计算截止时间，并将每日日志写入 `logs/`。默认从 `PATH` 寻找 `node`，也可通过 `NODE_BIN` 指定其绝对路径。

```sh
./run-once.sh
MAX_MINUTES=15 ./run-once.sh
```

将 `examples/com.example.visa-auto.plist` 复制到 `~/Library/LaunchAgents/`，把其中**所有** `/ABSOLUTE/PATH/TO/visa-auto` 替换为项目绝对路径，并修改运行时间及 `PATH`。请选择 macOS 允许后台进程访问的项目目录。

```sh
mkdir -p logs "$HOME/Library/LaunchAgents"
# 编辑并复制模板后加载：
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.example.visa-auto.plist"
# 停止定时任务：
launchctl bootout "gui/$(id -u)/com.example.visa-auto"
```

模板仅示例每天本机时间中午运行一次，需要电脑保持唤醒。看门狗结束超时会话，为后续任务留出空间；直接运行 `npm run login` 没有此时间上限。

## 隐私

仓库不包含真实凭据、安全答案、会话、日志或截图。`.env` 和运行产物已加入 Git 忽略规则，截图默认关闭。启用截图或分享日志前，请自行检查其中的个人信息。不要在 Issue 或 PR 中附上账号、答案或已登录页面数据。

## 项目结构

| 路径 | 职责 |
| --- | --- |
| `src/browser.js` | 临时浏览器配置、排队等待、可选截图 |
| `src/flow.js` | 登录、答案映射、页面导航和领区选择 |
| `src/login.js` | 单轮流程入口 |
| `src/open.js` | 手动浏览器入口 |
| `src/inspect.js` | 页面字段元数据检查 |
| `run-once.sh` | 带时间上限的 macOS 运行脚本 |
| `examples/` | 通用 launchd 模板 |
| `.env.example` | 空白本地配置模板 |

## 当前限制

项目处于实验阶段，网站选择器和账号对应的安全问题字段可能变化，需要用自己的授权账号验证。不包含空位监控、通知服务或自动预约功能。人机验证需要手动完成，定时脚本适用于 macOS。

## 参与贡献

欢迎用中文或英文提交 Issue、改进文档和贡献 PR。反馈问题时请描述预期与实际行为，并提供相关 Node.js/macOS 版本；示例中请移除全部个人信息。

提交前运行：

```sh
npm run check
zsh -n run-once.sh
```

浏览器流程请使用自己的授权账号验证，不要把凭据或会话记录加入测试。

---

<div align="center">

如果这个项目对你有帮助，欢迎 [点个 Star ⭐](https://github.com/Elyon0517/VisaPilot/stargazers)。

</div>

## 来源、版权与署名

原始仓库：[Elyon0517/VisaPilot](https://github.com/Elyon0517/VisaPilot)。
许可及第三方材料边界见 [COPYRIGHT.md](COPYRIGHT.md)，引用信息见 [CITATION.cff](CITATION.cff)。
请按适用许可证保留版权和许可声明；文章或演示中附上原仓库链接是署名建议，
不构成对已有开源许可的额外限制。使用或提及本项目不代表作者为相关产品背书。
