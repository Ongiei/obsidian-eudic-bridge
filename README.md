# LinkDict

[![Obsidian Downloads](https://img.shields.io/badge/dynamic/json?logo=obsidian&color=%23483699&label=downloads&query=%24%5B%22link-dict%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugins-stats.json)](https://obsidian.md/plugins?id=link-dict)
[![GitHub release](https://img.shields.io/github/v/release/Ongiei/obsidian-link-dict?include_prereleases)](https://github.com/Ongiei/obsidian-link-dict/releases)
[![License](https://img.shields.io/github/license/Ongiei/obsidian-link-dict)](LICENSE)

基于有道词典 API 的 Obsidian 词汇学习插件，支持词形还原（Lemma）自动识别，欧路词典双向同步。

## 功能特性

### 核心功能
- **在线查词** - 使用有道词典 API 查询单词，获取音标、释义、变形、例句等完整信息
- **词形还原** - 自动识别变形词（如 `running` → `run`），查询原形释义
- **双链生成** - 查词后自动将选中词替换为指向原形的双向链接 `[[run|running]]`
- **悬浮查词** - 选中文本后右键菜单快速查看释义，无需创建笔记
- **侧边栏词典** - 独立的词典侧边栏视图，方便持续查词学习
- **Markdown 笔记** - 生成的词汇笔记包含 YAML frontmatter，支持标签和别名

### 欧路词典集成
- **双向同步** - 支持 Obsidian 本地词库与欧路云端生词本双向同步
- **同步状态账本** - 智能追踪每个单词的同步状态，解决冲突
- **自动添加** - 在词库文件夹新建单词笔记时自动添加到欧路云端
- **云端删除处理** - 云端删除的单词会被标记并移动到指定文件夹

### 智能双链
- **自动链接** - 扫描当前文档，自动将本地词库中的单词转为双链
- **首次出现** - 可选仅链接每个单词的首次出现，避免页面杂乱
- **保留形态** - 保留原文大小写和形态（`doing` → `[[do|doing]]`）

### 批量更新
- **一键更新** - 批量更新所有从欧路同步的简略释义
- **API 节流** - 分批处理，防止接口封禁
- **Protocol URI** - 点击笔记中的链接即可更新单词详情

## 安装

### 方法一：社区插件市场（推荐）

1. 打开 Obsidian 设置 → 第三方插件
2. 关闭"安全模式"
3. 点击"浏览"搜索 "LinkDict"
4. 安装并启用

### 方法二：BRAT

1. 安装 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 插件
2. 在 BRAT 设置中添加仓库：`Ongiei/obsidian-link-dict`
3. 启用插件

### 方法三：手动安装

1. 从 [Releases](https://github.com/Ongiei/obsidian-link-dict/releases) 下载 `main.js`、`manifest.json`、`styles.css`
2. 放入 `.obsidian/plugins/link-dict/` 目录

## 使用方法

### 快速查词

1. 在编辑器中选中单词
2. 右键菜单选择 **Look up selection** 或使用命令面板执行 **Look up selection**
3. 在弹出的悬浮窗口中查看释义、音标、变形等信息

### 创建词汇笔记

1. 选中单词
2. 右键菜单选择 **Create lemma note** 或使用命令面板执行 **Create lemma note**
3. 插件将自动：
   - 查询单词原形
   - 生成 Markdown 笔记
   - 将选中词替换为双链 `[[lemma|original]]`

### 侧边栏词典

点击左侧功能栏的书籍图标，或在命令面板执行 **Open dictionary view** 打开侧边栏词典视图。

### 自动双链

1. 打开任意 Markdown 文档
2. 执行命令 **Auto-link words in current document**
3. 文档中所有本地词库存在的单词将自动转为双链

### 欧路词典同步

1. 在插件设置中配置欧路词典 API Token
2. 启用同步功能
3. 点击左侧同步图标或执行命令 **Sync with eudic now**

### 批量更新释义

1. 点击左侧批量更新图标或执行命令 **Batch update missing definitions**
2. 插件将扫描所有从欧路同步的简略释义笔记
3. 调用有道 API 更新完整释义

## 生成的笔记示例

```markdown
---
tags:
  - vocabulary
  - exam/CET4
  - exam/CET6
  - pos/v
aliases:
  - running
  - ran
  - runs
---

# run

## Pronunciation

- UK: `/rʌn/`
- US: `/rʌn/`

## Definitions

- ***vi.*** 跑，奔跑；运转
- ***vt.*** 管理，经营；运行
- ***n.*** 跑步；运行

## Web translations

- **run**: 1. 跑 2. 运行 3. 运转

## Examples

- He runs every morning.
  - 他每天早上跑步。

## Word forms

- 过去式: ran
- 过去分词: run
- 现在分词: running
- 第三人称单数: runs
```

## 配置选项

### 基本设置

| 选项 | 说明 | 默认值 |
|------|------|--------|
| Word storage folder | 词汇笔记存储目录 | `LinkDict` |
| Save exam tags | 保存考试标签到 frontmatter | 开启 |
| Show web translations | 显示网络释义 | 开启 |
| Show bilingual examples | 显示双语例句 | 开启 |

### 自动链接设置

| 选项 | 说明 | 默认值 |
|------|------|--------|
| Link first occurrence only | 仅链接每个单词的首次出现 | 开启 |
| Auto-add to eudic | 新建笔记时自动添加到欧路 | 开启 |

### 欧路词典设置

| 选项 | 说明 | 默认值 |
|------|------|--------|
| Eudic API token | 欧路词典 API Token | - |
| Default vocabulary list | 默认生词本 ID | `0` |
| Cloud-deleted folder | 云端删除文件的存放文件夹 | `LinkDict/trash` |

### 同步设置

| 选项 | 说明 | 默认值 |
|------|------|--------|
| Enable sync | 启用同步 | 关闭 |
| Sync direction | 同步方向（双向/仅上传/仅下载） | 双向 |
| Sync on startup | 启动时同步 | 关闭 |
| Startup delay | 启动延迟（秒） | `10` |
| Auto sync | 定时自动同步 | 关闭 |
| Sync interval | 同步间隔（分钟） | `30` |

### 批量更新设置

| 选项 | 说明 | 默认值 |
|------|------|--------|
| Chunk size | 每批处理数量 | `20` |
| Delay between batches | 批次间隔（秒） | `10` |

## 命令列表

| 命令 | 说明 |
|------|------|
| Open dictionary view | 打开词典侧边栏 |
| Create lemma note | 创建词元笔记 |
| Look up selection | 查询选中内容 |
| Auto-link words in current document | 自动链接当前文档 |
| Sync with eudic now | 立即与欧路同步 |
| Batch update missing definitions | 批量更新缺失释义 |

## 开发

```bash
# 安装依赖
npm install

# 开发模式（监听文件变化）
npm run dev

# 生产构建
npm run build

# 代码检查
npm run lint
```

## 项目结构

```
src/
├── main.ts           # 插件入口
├── settings.ts       # 设置面板
├── view.ts           # 侧边栏视图
├── popover.ts        # 悬浮查词
├── youdao.ts         # 有道词典 API
├── eudic.ts          # 欧路词典 API
├── sync.ts           # 同步服务
├── ledger.ts         # 同步状态账本
├── auto-link.ts      # 自动双链
├── batch-update.ts   # 批量更新
├── lemmatizer.ts     # 词形还原
├── types.ts          # 类型定义
└── i18n.ts           # 国际化
```

## 版本说明

| 版本 | 说明 |
|------|------|
| v3.0.0+ | 欧路词典双向同步、智能双链、批量更新 |
| v2.0.0+ | 使用有道在线 API，数据全面及时，需网络连接 |
| v1.0.x | 基于 ECDICT 本地数据，完全离线使用 |

## 致谢

- [有道词典](https://dict.youdao.com/) - 词典数据来源
- [欧路词典](https://my.eudic.net/) - 云端生词本同步
- [wink-lemmatizer](https://github.com/winkjs/wink-lemmatizer) - 词形还原
- [Obsidian](https://obsidian.md/) - 知识管理平台

## License

[0-BSD](LICENSE)