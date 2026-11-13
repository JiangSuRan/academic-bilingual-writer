# Academic Bilingual Writer · 学术双栏写作台

[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-blue)](#) [![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE) [![Tauri 2](https://img.shields.io/badge/Tauri-2-orange)](#) [![Tests](https://img.shields.io/badge/tests-47%2F47%20passed-brightgreen)](docs/TESTING.md)

一款面向医学科研人员的**中英双栏 SCI 论文写作桌面应用**:左侧用中文组织研究思路,右侧获得对应的学术英文;英文始终可以直接编辑,完成后以纯文本一键复制进 Microsoft Word。

> 不是 Markdown 编辑器,不是 LaTeX 编辑器,不是 PDF 翻译器,也不是文献管理软件——它只做好一件事:**让中文科研写作与英文论文表达在同一个窗口中高效协作**。

<p align="center"><img src="src-tauri/icons/icon.png" width="120" alt="Academic Bilingual Writer"/></p>

## 功能特性

### 双栏写作核心
- **段落一一对应**:每对中英段落持有稳定唯一 ID,插入、删除、拆分(Enter)、合并(段首 Backspace)都不会导致错位
- **六态状态机**:未翻译 / 已生成 / 中文已修改 / 英文已人工编辑 / 翻译中 / 生成失败,一眼看清全稿进度
- **防覆盖机制**:中文修改后旧英文保留并标记"需更新";英文一经人工编辑 AI 永不自动覆盖;重译/润色结果先进**待确认缓冲**,你比较后决定替换或保留
- 可拖拽分隔线、双侧独立字号、明暗双主题、同步滚动与按段定位

### AI 能力(OpenAI 兼容接口)
- 段落生成 / 批量翻译(严格串行防限流)/ 学术润色 / 语法检查 / 保留原意简化
- 流式输出可中途停止;失败可重试且**绝不清空已编辑文本**
- 多模型配置一键切换,内置 OpenAI / DeepSeek / 本地模型预设,支持任意兼容端点(Qwen、OpenRouter、llama.cpp 等)

### 医学 SCI 提示词体系
- 内置肿瘤学、临床医学、生物信息学、分子生物学、转录组学、单细胞组学的翻译规范
- **统计信息红线**:P / HR / OR / RR / 95% CI、q/FDR、基因名、单位逐字保留;`associated with` 绝不升级为 `promotes / induces / drives`
- 按 Abstract / Introduction / Methods / Results / Discussion 分节施加风格约束(时态、信息结构、谨慎措辞)
- **术语表按需注入**:`中文 => English` 每行一条,仅当前段落命中的术语随请求发送
- 有界上下文:自动携带上一段中英文摘录,保证跨段衔接

### 确定性润色审计(零 Token)
内置 biomedical-polish 引擎(浏览器端毫秒级运行,不消耗 LLM Token):
- **润色审计**:对 AI 润色结果做事实保真校验(数值/基因名/统计符号不得被改动)
- **文风体检**:全稿学术语言质量分析,标记夸大措辞、AI 腔、冗余表达
- **骨架模式匹配**:按场景、论文体裁与生信关键词按需注入写作骨架,并严格隔离算法评估类模板

### 本地文稿与数据安全
- `.abw.json` 单文件格式(UTF-8 JSON,易于检查与恢复)
- 自动保存(1.2s 防抖)+ **原子写入**(临时文件 + rename)+ 每文稿 20 份滚动备份
- 重启自动恢复上次文稿;导出英文 TXT / 中英对照 TXT
- **API Key 存于 Windows 凭据管理器**,不落任何明文文件;无遥测,仅在你主动触发 AI 操作时发送必要文本

## 安装

从 [Releases](../../releases) 下载 `Academic Bilingual Writer_x64-setup.exe`(NSIS 安装包,约 3 MB,当前用户安装、无需管理员权限),双击安装即可。需要 Windows 10/11(系统自带 WebView2)。

> 未签名应用,SmartScreen 可能提示"更多信息 → 仍要运行"。

### 首次使用

1. 点击右上角 **设置**,填写模型服务的 Base URL、模型名与 API Key,**保存密钥**并**测试连接**
2. 左栏输入中文 → `Ctrl+Enter` 生成英文(或在设置中开启停顿自动翻译)
3. 直接编辑右栏英文;重译结果会先进入待确认缓冲
4. **复制英文** → 粘贴进 Word(纯文本,无任何格式污染)

## 快捷键

| 快捷键 | 作用 |
|---|---|
| `Ctrl+Enter` | 生成/重译当前段落(拼音组合输入期间不触发) |
| `Ctrl+S` / `Ctrl+N` | 立即保存 / 新建文稿 |
| `Ctrl+Shift+C` | 复制全部英文 |
| 中文区 `Enter` / `Shift+Enter` | 光标处拆段 / 段内换行 |
| 中文区段首 `Backspace` | 并入上一段 |

## 开发

依赖:Node.js ≥ 20、Rust stable (msvc)、Windows C++ Build Tools、WebView2。

```bash
npm install
npm run tauri dev      # 开发调试
npm test               # 前端单元测试(vitest,47 用例)
npm run build          # tsc 类型检查 + vite 前端构建
cd src-tauri && cargo test   # Rust 单元测试(6 用例)
npm run tauri build    # 生成 Windows 安装包(NSIS)
```

### 技术栈与架构

| 层 | 技术 |
|---|---|
| 桌面框架 | Tauri 2(WebView2 渲染) |
| 前端 | React 18 + TypeScript + Vite 6 + zustand v5 |
| 后端 | Rust(reqwest 流式 SSE、keyring 凭据、原子文件 IO、rfd 对话框) |
| AI | OpenAI 兼容 /chat/completions,流式输出 |

关键设计:段落以稳定 ID 锚定对应关系;`enSourceZh` 快照使"中文已修改"状态在重启后依然正确;提示词中场景/术语/上下文置于 system 消息、user 消息仅含正文,避免弱模型把标签一起"翻译"。详见 `docs/TECH_NOTES.md`。

### 项目结构

```
src/
  components/   Toolbar / Workspace / ParaCard / SettingsPanel / ReviewModal
  lib/          prompts / glossary / paragraphs / polishAudit / patternMatcher / ai 通道
  store/        zustand 状态仓库(状态机/防覆盖/自动保存)
src-tauri/
  src/          commands(IO/凭据/AI 流式/对话框) / ai(SSE 解析) / doc_io(原子写入+备份)
docs/           TECH_NOTES(技术决策) / TESTING(测试报告) / PROGRESS(验收记录)
```

## 测试

- **自动化 53 项全过**:vitest 47/47(状态机、术语匹配、提示词、润色审计、模式匹配)+ cargo test 6/6(SSE 解析、原子写入、备份裁剪)+ clippy 零警告
- **13 项端到端实测**:真实模型流式回路、强杀进程后恢复、网络失败零丢失、统计信息逐字保留、剪贴板纯文本验证等,完整记录见 [docs/TESTING.md](docs/TESTING.md)

## 许可证

[MIT](LICENSE)。本项目未复制任何 GPL 代码;开发过程中参考了以下开源项目的交互设计(详见 `docs/TECH_NOTES.md` 中的许可证分析):

- [duo-translator](https://github.com/linuxscreen/duo-translator)(GPL-3.0,仅借鉴交互思路)
- [parallel-translator](https://github.com/llbbaagg66/parallel-translator)(MIT)
- [opentrans](https://github.com/CoderXiaopang/opentrans)(无 LICENSE,仅借鉴概念)
- [scholar-assistant-agent](https://github.com/zuowen7/scholar-assistant-agent)(MIT)

## 已知限制

详见 [docs/TESTING.md](docs/TESTING.md)。摘要:仅打包 Windows x64;AI 请求强制直连不走系统代理;批量翻译串行;安装包未签名;段落暂无上移/下移按钮(ID 机制已支持)。
