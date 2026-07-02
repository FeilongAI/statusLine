[English](README.md) | [中文](README.zh-CN.md)

# Claude Code HUD

一个 [Claude Code](https://claude.com/claude-code) 的两行状态栏（statusline），把模型、上下文用量、effort 档位、系统负载、5 小时 / 7 天用量配额浓缩成一眼可读的 HUD。

```
🇯🇵 Opus 4.8 · v2.0.14 · ctx 52% · 💭 On · effort xhigh · 📁 ~/projects/myapp
cpu 32% · mem 37% · disk 11% · 5h ●●●○○ 58% ↻3h10m · 7d ●○○○○ 17% ↻5d3h
```

所有条目之间用弱化的 `·` 分隔，两行相互独立、不做列对齐——emoji 宽度差异永远不会打乱排版。

## 显示内容

| 第一行 | 含义 |
|--------|------|
| `🇯🇵` | 可选的旗帜/emoji 前缀（默认关闭，见[配置](#配置)） |
| `Opus 4.8` | 当前模型，已清洗（去掉 `Claude ` 前缀、`(1M context)` / `[1m]` 尾巴），按模型家族着色 |
| `v2.0.14` | Claude Code 版本 |
| `ctx 52%` | 上下文窗口用量，按健康度着色 |
| `💭 On` | Always-thinking 模式开/关 |
| `effort xhigh` | 推理 effort 档位，颜色随强度递增 |
| `📁 ~/path` | 工作目录，智能缩短（git worktree 显示为 `repo:wt/name`） |

| 第二行 | 含义 |
|--------|------|
| `cpu 32%` | CPU 利用率（仅 Linux） |
| `mem 37%` | 内存用量（仅 Linux） |
| `disk 11%` | 磁盘用量，挂载点可配置（全平台） |
| `5h ●●●○○ 58% ↻3h10m` | 5 小时配额：进度环、百分比、重置倒计时 |
| `7d ●○○○○ 17% ↻5d3h` | 7 天配额，同上 |

所有百分比共用一套健康度配色：**<50 绿 · 50–75 黄 · 75–90 橙 · ≥90 红**。整个 HUD 还会跟随 Claude Code 主题——`light*` 主题下自动切换为深色的 Flexoki 墨水色板，浅色背景上也不会泛白看不清。

## 安装

**一行命令：**

```bash
curl -fsSL https://raw.githubusercontent.com/yang1997434/claude-code-hud/main/install.sh | bash
```

**或克隆后安装：**

```bash
git clone https://github.com/yang1997434/claude-code-hud.git
cd claude-code-hud && ./install.sh
```

**或者直接让你的 Claude 装**——把这句话粘贴进 Claude Code：

> 安装 https://github.com/yang1997434/claude-code-hud 这个状态栏：下载它的 install.sh 并执行，然后确认 ~/.claude/settings.json 里的 statusLine 配置已生效。

安装器会把 `hud.mjs` 复制到 `~/.claude/hud/`，先备份你的 `settings.json`，再把 `statusLine` 指向脚本。重启 Claude Code 即可看到 HUD。

### 环境要求

- **Node.js ≥ 18.15**（依赖全局 `fetch` 和 `statfsSync`）
- 配额段需要 Claude Code **订阅登录**（Pro/Max）——它读取的就是 CLI 自己用的 usage API。API key 用户的配额段不会显示，其余功能不受影响。
- 配额与 cpu/mem 段均优雅降级：拿不到的数据直接跳过，绝不报错。

## 配置

可选。创建 `~/.claude/hud/config.json`：

```json
{
  "flag": "🇯🇵",
  "diskPath": "/data"
}
```

| 键 | 默认值 | 作用 |
|----|--------|------|
| `flag` | `""`（隐藏） | 模型名前面的 emoji/文本前缀——地区旗帜、主机标记都行 |
| `diskPath` | `"/"` | `disk` 段统计的挂载点 |

## 工作原理

- Claude Code 按 `statusLine.refreshInterval`（2 秒）调用脚本，并通过 stdin 传入会话 JSON——模型、版本、上下文窗口、effort、工作目录。
- 配额数据来自 Anthropic 的 OAuth usage 端点（`api.anthropic.com/api/oauth/usage`），凭据复用你已有的 Claude Code 登录态：依次尝试 `CLAUDE_CODE_OAUTH_TOKEN` 环境变量、macOS 钥匙串、`~/.claude/.credentials.json`；token 过期会向 `platform.claude.com` 自动刷新。响应缓存 60 秒（`~/.claude/hud/.usage-cache.json`），临时报错时保留上次成功数据，配额行不会闪空。
- **隐私：** 你的 token 只会发往上述两个 Anthropic 官方端点，不会离开本机去任何别的地方。
- CPU% 通过两次 `/proc/stat` 采样求差得出（快照缓存在 `~/.claude/hud/.sys-cache.json`），因此首次渲染显示 `cpu —`，从第二次刷新起稳定。

## 卸载

```bash
./uninstall.sh
```

移除 `statusLine` 配置（仅当它指向本 HUD 时）、脚本及缓存文件。

## 许可证

[MIT](LICENSE)
