[English](README.md) | [中文](README.zh-CN.md)

# Claude Code HUD

给 [Claude Code](https://claude.com/claude-code) 用的三行状态栏，按列对齐。模型、上下文、会话缓存命中率、输出速度、系统负载、5 小时 / 7 天配额，一眼看完。

```
Opus 5    ⋮ xhigh     ⋮ 💭 On      ⋮ 📁 ~/projects/myapp
ctx  52%  ⋮ CH  99.2% ⋮ tok/s  164 ⋮ 5h ●●●○○ 58% ↻3h10m
cpu  33%  ⋮ mem  34%  ⋮ disk  16%  ⋮ 7d ●○○○○ 17% ↻5d3h
```

前三列宽度**写死**，不随内容变。所以数值从 9% 跳到 100%、换个模型、effort 从 low 变 ultracode，后面的列一格都不会动。第四列不设宽度，装的是路径和配额条这些天生变长的东西，放在最右边，右边参差不影响左边任何一格。

分隔符用虚线 `⋮` 而不是实线 `│` 是刻意的：实线竖着叠三行会焊成一条不断的线，整个 HUD 就读成一个被框住的表格，而不是三行独立的信息。

## 上面有什么

| 列 | 第一行 | 第二行 | 第三行 |
|----|--------|--------|--------|
| 1 | 当前模型，名字清洗过、按系列配色 | 上下文窗口占用 | CPU 占用 |
| 2 | 推理强度，按强度渐变配色 | **会话缓存命中率** | 内存占用 |
| 3 | 常驻思考开关 | **输出速度** | 磁盘占用 |
| 4 | 工作目录（worktree 显示成 `repo:wt/name`） | 5 小时配额 | 7 天配额 |

**CH** 是**整个会话**的缓存命中率：`缓存读 ÷ (缓存读 + 缓存写 + 未缓存输入)`。这个指标越高越好，所以配色是反着的 —— 99% 显示为绿色。

**tok/s** 是最近 5 次完成请求的输出速度，按输出量加权，一条短回复扇不动数字。单次耗时不足 1 秒的样本直接丢弃 —— 那种数据反映的是日志刷盘时机，不是模型生成速度。

百分比共用一套健康色阶：**<50 绿 · 50–75 黄 · 75–90 橙 · ≥90 红**。整个 HUD 跟随 Claude Code 主题，`light*` 主题下会换成一套深色 Flexoki 墨色，避免在浅底上发白。

## 安装

**一行命令：**

```bash
curl -fsSL https://raw.githubusercontent.com/yang1997434/claude-code-hud/main/install.sh | bash
```

**或者从 clone 装：**

```bash
git clone https://github.com/yang1997434/claude-code-hud.git
cd claude-code-hud && ./install.sh
```

**或者直接让 Claude 装** —— 把这段贴进 Claude Code：

> 安装 https://github.com/yang1997434/claude-code-hud 这个状态栏：拉取它的 install.sh 并执行，然后确认 ~/.claude/settings.json 里的 statusLine 配置。

安装脚本把 `hud.mjs` 复制到 `~/.claude/hud/`，备份你的 `settings.json`，再把 `statusLine` 指向该脚本。重启 Claude Code 即可看到。

### 环境要求

- **Node.js ≥ 18.15**（需要 `statfsSync`）
- Claude Code **2.0.71+**，这个版本起 statusline 的输入里带 `rate_limits`。更早的版本配额那一列不显示。
- 配额列需要**订阅账号**（Pro/Max）。用 API key 的话那两格不渲染，其余照常。
- CPU 和内存读 `/proc`，仅限 Linux。取不到的数据静默跳过，不会报错。

## 配置

可选。新建 `~/.claude/hud/config.json`：

```json
{
  "diskPath": "/data",
  "cols": [9, 9, 10],
  "sep": "⋮"
}
```

| 键 | 默认值 | 作用 |
|----|--------|------|
| `diskPath` | `"/"` | `disk` 那格统计哪个挂载点 |
| `cols` | `[9, 9, 10]` | 前三列的固定宽度。模型名或标签放不下就调宽 |
| `sep` | `"⋮"` | 列分隔符。`"┊"`、`"╎"`、`"¦"` 也都好看；设成 `""` 则不画分隔符、只靠列宽对齐 |

## 工作原理

- Claude Code 按 `statusLine.refreshInterval`（默认 2 秒）调用脚本，把会话数据从 stdin 传进来：模型、上下文窗口、effort、思考开关、工作目录，以及 `rate_limits`。**不发网络请求、不读凭据、不刷新 token** —— 配额数字是 Claude Code 直接给的。
- **CH** 和 **tok/s** 是会话级的事实，stdin 给不了（它的 `current_usage` 只描述最近一次请求），所以从会话的 transcript JSONL 里聚合。扫描是增量的：`~/.claude/hud/.session-cache.json` 里存着字节 offset 和累计值，每次渲染只解析新追加的那部分。请求按 `requestId` 去重 —— 一次响应会写成多条 transcript 记录，而这些记录里的 usage 是重复的累计值。
- 列对齐是量出来的，不是猜的：先剥掉 ANSI 色码，再按字素簇遍历，emoji、国旗、CJK 按两格计算。
- CPU 占用需要两次 `/proc/stat` 采样求差值，样本缓存在 `~/.claude/hud/.sys-cache.json`，所以首次渲染显示 `cpu —`，第二次刷新起才有数字。
- **隐私**：没有任何数据离开你的机器。HUD 只读本地文件和自己的 stdin。

## 卸载

```bash
./uninstall.sh
```

移除 `statusLine` 配置（仅当它指向本 HUD）、脚本本身和缓存文件。

## License

[MIT](LICENSE)
