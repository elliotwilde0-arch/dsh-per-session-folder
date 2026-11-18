# Session Folders（会话独立文件夹）

> **本仓库是改编版，不是原插件。** 上游：[hhuapen/dsh-per-session-folder](https://github.com/hhuapen/dsh-per-session-folder)（MIT）。
> 基线是上游 `v0.1.1`（2026-11-02），只改了 `client.js`，在原有兼容层里补了一段文件地址处理。
> 上游问题分析见 [issue #1](https://github.com/hhuapen/dsh-per-session-folder/issues/1)，版本差异见 [CHANGELOG.md](./CHANGELOG.md)。

## 这个插件是做什么的

给默认工作区里的每个新会话分配一个独立文件夹，并按会话标题给文件夹命名。临时会话、试验脚本、下载文件各自待在自己的目录里，不会串到下一个会话。

- 新会话自动创建文件夹，先用 `会话-时间戳-ID` 中性名，等 LLM 标题生成后再改名；不再拿消息原文（含 @路径/网址）当文件夹名
- 重名自动加 `-2`、`-3`
- 「在文件夹中打开」和本地文件操作指向当前会话文件夹
- 会话文件夹里放 `.dsh-per-session-folder.json` 标记，重启后能认回自己的目录
- 不新增侧边栏工作区，不改变历史会话的工作区归属

## 为什么要改编

原插件在 DSH `0.2.2-rc.1` 上有一个可见的 bug：**从右侧侧边栏、聊天里的文件卡片、交付物卡片点开会话文件夹里的文件，会提示「文件不存在，可能已被移动或删除」，但文件其实好好地躺在磁盘上。** 把路径复制到资源管理器里能正常打开。

### 成因

这不是文件丢了，是路径的基准对不上，分两半：

1. 插件为了让「在文件夹中打开」指向会话目录，会把 DSH 客户端会话列表里的 `cwd` 从工作区根改写成会话文件夹（`client.js` 里的镜像逻辑）。
2. DSH 核心据此构造「相对于工作区」的文件地址，于是地址被剥成了 `报告.json` 这样的裸文件名；而 Host 端工作区文件服务解析相对路径用的基准是会话 header 里的 `cwd` —— 这个值永远是创建会话时的工作区根，DSH 不会因为工作目录变更而回写它。两边一错位，`lstat` 就落在 `default-workspace\报告.json`，而文件真正的路径是 `default-workspace\会话文件夹\报告.json`，于是返回 `workspace-file/not-found`。

会话文件夹还会随标题改名，任何早先记下的路径都会跟着失效，进一步放大了这个问题。

### 改了什么

只动 `client.js`，全部是新增代码，共 3 处插入（15475 → 28907 字节）：

1. **在读取出口归一化地址。** 包装 `remote.workspaceFiles` 的 `read` / `stat` / `readBytes` / `list`：拿到裸相对路径时先补上会话文件夹前缀再请求，只有在返回 `workspace-file/not-found` 时才退回原路径 —— 最坏情况与原插件行为完全一致。
2. **前缀有两个来源。** 一是镜像 `cwd` 时记下的相对段；二是从会话列表的 `projectionValues.workingDirectory` 反推，所以即使是重启后重新打开的历史会话（没有实时 agent）也能算出来。
3. **顺带收敛重复前缀。** `文件夹/文件夹/文件` 会被折成 `文件夹/文件夹`一次，`openResource` 上也做了同样处理。
4. **不碰 DSH 安装目录。** 兼容层写在自己的插件里，DSH 一个字节没改；想恢复原样，把本仓库的 `client.js` 换成上游那份即可。

### 版本说明

- `0.1.2` 只包装了 `sidebarRight.openResource`，而文件读取根本不走那条路，**等于没修**，已被 `0.1.3` 取代。
- `0.1.3` 补上了 `remote.workspaceFiles` 这一面。
- `0.1.4` 修的是「改过一次名就永久失效」：地址前缀改为实时读取，并记住用过的旧名。
- `0.2.0` 收敛改名行为（只改一次）并加了兜底重试。
- `0.3.0` 修复「原文抢跑消耗唯一改名机会」：文件夹命名改为等待 LLM 标题，改名策略可配置，见下一节。现在这是实机验证通过的版本。

## 文件夹命名：等标题，策略可配

### 为什么要改

0.2.0 的「只改一次」闸门本身没问题，问题是唯一一次改名被用得太早：插件在第一轮第一步就执行改名，而 DSH 的 LLM 标题要等主请求发出后才异步生成，那时 `title || text` 只能取到首条消息原文——开头引用本地文件或网址时，文件夹就成了 `@C--Users-…-收益凭证.xlsx 帮我处理…` 这样的名字，真正的好标题到达时反而被闸门永久拒绝。

### 0.3.0 的命名顺序

1. 创建时先用中性名 `会话-YYYYMMDD-HHMMSS-ID`。
2. 只有来源为 `provider`（LLM 生成）或 `user`（手动改名）的 `session/title` 事件才触发文件夹改名；DSH 的 `fallback` 标题（原文前导词）一律忽略。
3. 若 `textFallbackTurns` 个回合（默认 3）后仍没有 LLM/手动标题，用剥掉 @引用和网址后的首条消息文本命名一次；之后 LLM 标题到达还能把这个兜底名升级一次。

### 改名策略（插件设置里可改）

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `renamePolicy` | `once` | `once`：第一个 LLM/手动标题改一次名后锁定；`follow`：跟随每次标题更新（适配「随对话更新标题」，受 `maxRenames` 限制）；`never`：从不自动改名 |
| `followUserRename` | `true` | 在侧边栏手动重命名会话时文件夹跟随改名（不受 `once`/`never` 锁定影响） |
| `maxRenames` | `3` | `follow` 模式下自动改名次数上限（手动改名不计入） |
| `textFallbackTurns` | `3` | 多少个回合没有标题就用清洗文本兜底；`0` 禁用兜底，保持时间戳名 |

每次改名都伴随三件事：迁移工作目录、已打开文件地址失效、往上下文里注入一条 working-directory 变更提示，所以默认仍是「只改一次」。想让文件夹始终与侧边栏标题一致，把 `renamePolicy` 改成 `follow` 即可。0.2.0 的旧地址自愈逻辑保留：读取返回 `workspace-file/not-found` 时，若地址第一段已不存在就删段重试一次，改名之前打开的标签页仍能读到文件。

## 安装

要求 DSH `>=0.2.1-rc.3 <0.3.0`。

私有仓库，两种装法：

```powershell
# 1) 从仓库装（需要本机有 GitHub 凭据）
dsh plugin add github:elliotwilde0-arch/dsh-per-session-folder

# 2) 从本地安装包装（不需要联网）
dsh plugin add C:\path\to\dsh-per-session-folder-0.3.0.tgz
```

也可以在「插件管理」里把安装来源填成上面的值。装完**完整退出并重启 DSH** —— 客户端插件在启动时读入并缓存，重启前跑的还是旧代码。

## 验证是否生效

重启后打开侧边栏里的文件，正常情况下不再报「文件不存在」。想确认补丁真的挂上了，按 `Ctrl+Shift+I` 打开 DevTools，控制台里应该有一行：

```
[psf] workspaceFiles shim active: read:own, stat:own, readBytes:own, list:own
```

看不到这行说明补丁没生效：要么插件被还原成了原版（`node_modules` 里被重新安装覆盖），要么 DSH 没有真正重启。

命名行为的验证：重启后新开一个对话，开头引用一个本地文件再提问。文件夹应先叫 `会话-时间戳-ID`，等侧边栏出现 LLM 标题后改成标题名，而不再是 `@C--…` 原文。

如果文件夹一直停在时间戳名或清洗文本兜底名，先看侧边栏标题本身有没有在更新：文件夹命名完全依赖 DSH 的 `session/title`（`provider`/`user` 来源）。一个实测过的坑：标题辅助请求的输出预算太小（内置 all-prompts 配置 `maxOutputTokens: 64`），而网关上的推理型模型默认先思考，64 个 token 全被推理吃掉，标题调用以 `max-tokens` 结束、没有正文，静默失败，侧边栏永远停在原文 fallback 标题。解法是在 profile 的 `cordis.patch.yml` 里给标题插件（`optional-session-title-all-prompts` / `session-title-llm`）配置完整的 `maxOutputTokens: 4096` 并钉住一条便宜可用的路由（补丁是整体替换 config，所有字段都要写全）。

## 跟随上游更新

上游发新版后，把本仓库的 `client.js` 与上游新版的差异看一遍就知道还需不需要这个补丁。需要的话，用 `apply_patch.cjs` + `patch_block.js` 对新版 `client.js` 重打一次（脚本会先做语法校验，失败会拒绝写出）。

## 已知限制

- 依赖 DSH 内部客户端接口（`remote.workspaceFiles` 的注入名、`sidebarRight.openResource`），DSH 大版本升级后可能失效，失效时退化为上游原有行为。
- 预留给排障的 `[psf]` 前缀日志保留在代码里，不影响功能。
- 只修「打不开」；目录策略、标记文件机制未动。0.3.0 起文件夹命名等待 LLM 标题，改名策略可配置（`once`/`follow`/`never`）。
- 兜底重试会多一次 `stat`；只有在第一段确实不存在时才重试，正常读取的路径不受影响。
- 会话文件夹需要是工作区根的直接子目录才生效（默认配置就是这样）。
- `follow` 模式的改名计数持久化在标记文件里；0.2.0 及更早创建的文件夹没有计数字段，重启后按 0 计。

## 许可

MIT，原始版权归 [hhuapen](https://github.com/hhuapen) 所有。本改编版同样以 MIT 发布。
