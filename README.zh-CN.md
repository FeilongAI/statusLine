[English](README.md) | [中文](README.zh-CN.md)

# Claude Code HUD

> 基于 [yang1997434/claude-code-hud](https://github.com/yang1997434/claude-code-hud)（MIT）修改：补充 macOS 的 CPU/内存读取，目录只显示当前一级。

给 [Claude Code](https://claude.com/claude-code) 用的三行状态栏，按列对齐。模型、上下文、会话缓存命中率、输出速度、系统负载、5 小时 / 7 天 / 按模型的周配额，一眼看完。

```
Opus 5.5        ⋮ ctx      52% ⋮ cpu    8% ⋮ 5h    ●●●○○  58% ↻3h10m
xhigh 💭On      ⋮ tok/s    105 ⋮ mem   34% ⋮ 7d    ●○○○○  17% ↻5d3h
📁 ~/code/myapp ⋮ Cache  99.0% ⋮ disk  21% ⋮ Fable ●○○○○  16% ↻2d11h
```

前三列宽度**写死**，不随内容变。所以数值从 9% 跳到 100%、换个模型、路径再长，后面的列一格都不会动（长路径只保留末尾，如 `~/projects/myapp` 显示成 `…jects/myapp`）。指标格里标签靠左、数值靠右贴边，同一列的数字共用一条右边缘。第四列不设宽度，装的是三行配额，它们之间按最宽的标签对齐，放在最右边，右边参差不影响左边任何一格。

分隔符用虚线 `⋮` 而不是实线 `│` 是刻意的：实线竖着叠三行会焊成一条不断的线，整个 HUD 就读成一个被框住的表格，而不是三行独立的信息。

## 上面有什么

| 列 | 第一行 | 第二行 | 第三行 |
|----|--------|--------|--------|
| 1 | 当前模型，名字清洗过、按系列配色 | 推理强度（按强度配色）+ 常驻思考开关 | 当前目录名，不带父级路径（worktree 显示成 `repo:wt/name`） |
| 2 | 上下文窗口占用 | **输出速度** | **会话缓存命中率** |
| 3 | CPU 占用 | 内存占用 | 磁盘占用 |
| 4 | 5 小时配额 | 7 天配额 | **按模型的周配额**（标签是模型名；它是当前卡住你的那条限额时加粗） |

**Cache** 是**整个会话**的缓存命中率：`缓存读 ÷ (缓存读 + 缓存写 + 未缓存输入)`。这个指标越高越好，所以配色是反着的 —— 99% 显示为绿色。

**tok/s** 是最近 5 次完成请求的输出速度，按输出量加权，一条短回复扇不动数字。单次耗时不足 1 秒的样本直接丢弃 —— 那种数据反映的是日志刷盘时机，不是模型生成速度。

百分比共用一套健康色阶：**<50 绿 · 50–75 黄 · 75–90 橙 · ≥90 红**。整个 HUD 跟随 Claude Code 主题，`light*` 主题下会换成一套深色 Flexoki 墨色，避免在浅底上发白。

## 安装

**作为 Claude Code 插件安装**（以后用 `/plugin update` 升级）—— 在 Claude Code 里依次执行：

```
/plugin marketplace add FeilongAI/statusLine
/plugin install claude-code-hud@claude-code-hud
/claude-code-hud:setup
```

插件没法自己接管主状态栏，所以要跑一次 `setup`：你已经有别的状态栏时它会先问你，然后执行下面同一个 `install.sh`。之后插件在每次会话启动时把 `~/.claude/hud/hud.mjs` 同步成插件里的最新版，升级就是 `/plugin update` 再开一个新会话。想调显示请改 `config.json`；直接改脚本会被覆盖，想自己改脚本请用下面的脚本安装。

**或者一行命令：**

```bash
curl -fsSL https://raw.githubusercontent.com/FeilongAI/statusLine/main/install.sh | bash
```

**或者从 clone 装：**

```bash
git clone https://github.com/FeilongAI/statusLine.git
cd statusLine && ./install.sh
```

**或者直接让 Claude 装** —— 把这段贴进 Claude Code：

> 安装 https://github.com/FeilongAI/statusLine 这个状态栏：拉取它的 install.sh 并执行，然后确认 ~/.claude/settings.json 里的 statusLine 配置。

不管哪种方式，安装脚本都会把 `hud.mjs` 复制到 `~/.claude/hud/`，备份你的 `settings.json`，再把 `statusLine` 指向该脚本。重启 Claude Code 即可看到。

### 环境要求

- **Node.js ≥ 18.15**（需要 `statfsSync`）
- Claude Code **2.0.71+**，这个版本起 statusline 的输入里带 `rate_limits`。更早的版本配额那一列不显示。
- 配额列需要**订阅账号**（Pro/Max）。用 API key 的话那几格不渲染，其余照常。
- 按模型的周配额那一行需要 Claude Code 本地已存的 OAuth token（macOS Keychain、`~/.claude/.credentials.json` 或 `CLAUDE_CODE_OAUTH_TOKEN`）。没有的话只是少这一行。
- Linux 或 macOS（安装脚本和插件钩子是 bash）；Windows 未测试。
- CPU 和内存在 Linux 上读 `/proc`；macOS 上 CPU 用 `os.cpus()`、内存解析 `vm_stat`（App + 联动 + 压缩，与活动监视器「已使用内存」同口径）。取不到的数据静默跳过，不会报错。

## 配置

可选。新建 `~/.claude/hud/config.json`：

```json
{
  "diskPath": "/data",
  "cols": [22, 12, 9],
  "sep": "⋮"
}
```

| 键 | 默认值 | 作用 |
|----|--------|------|
| `diskPath` | `"/"` | `disk` 那格统计哪个挂载点 |
| `cols` | `[22, 12, 9]` | 前三列的固定宽度。目录名显示不全就调宽第一列；后两列按 `Cache 100.0%` 和 `disk 100%` 定的 |
| `sep` | `"⋮"` | 列分隔符。`"┊"`、`"╎"`、`"¦"` 也都好看；设成 `""` 则不画分隔符、只靠列宽对齐 |
| `icons` | 自动 | `💭` / `📁` 图标。自动模式下在 JetBrains 内置终端里关闭（JediTerm 画 emoji 会溢出两格、盖住旁边的字）；`true` / `false` 强制开关

## 工作原理

- Claude Code 按 `statusLine.refreshInterval`（默认 2 秒）调用脚本，把会话数据从 stdin 传进来：模型、上下文窗口、effort、思考开关、工作目录，以及 `rate_limits`。5h / 7d 两个数字直接来自这份数据，不经过网络。
- **按模型的周配额**是唯一一个 Claude Code 不传给 statusline 的数字。它从 CLI 自己用的那个 OAuth usage 接口读，用的是 Claude Code 已存的 token（这个 access token 过期时，会用已存的 refresh token 为这一次调用换一个新的，新 token 只在内存里用、不写回），结果缓存在 `~/.claude/hud/.usage-cache.json` 里 60 秒（出错后 30 秒），2 秒一次的刷新不会以这个频率打 API。临时失败时保留上一次的读数。设 `HUD_DEBUG=1` 可以看到请求失败的原因。
- **Cache** 和 **tok/s** 是会话级的事实，stdin 给不了（它的 `current_usage` 只描述最近一次请求），所以从会话的 transcript JSONL 里聚合。扫描是增量的：`~/.claude/hud/.session-cache.json` 里存着字节 offset 和累计值，每次渲染只解析新追加的那部分。请求按 `requestId` 去重 —— 一次响应会写成多条 transcript 记录，而这些记录里的 usage 是重复的累计值。
- 列对齐是量出来的，不是猜的：先剥掉 ANSI 色码，再按字素簇遍历，emoji、国旗、CJK 按两格计算。
- CPU 占用需要两次 `/proc/stat`（macOS 为 `os.cpus()`）采样求差值，样本缓存在 `~/.claude/hud/.sys-cache.json`，所以首次渲染显示 `cpu —`，第二次刷新起才有数字。
- **隐私**：出站请求只发往 Anthropic —— usage 接口，以及已存 token 过期时的一次换 token 请求 —— 用的都是 Claude Code 已有的凭据。除此之外没有任何数据离开你的机器，HUD 只读本地文件和自己的 stdin。

## 卸载

插件安装的 —— 在 Claude Code 里：

```
/claude-code-hud:uninstall
/plugin uninstall claude-code-hud@claude-code-hud
```

脚本安装的：

```bash
./uninstall.sh
```

两种方式都会移除 `statusLine` 配置（仅当它指向本 HUD）、脚本本身和缓存文件；`config.json` 保留。

## License

[MIT](LICENSE)
