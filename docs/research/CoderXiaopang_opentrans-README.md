# OpenTrans

> 很多优秀的开源框架只有英文文档，机器翻译准确率低，在翻译网页和代码编辑器之间来回切换更是打断思路。OpenTrans 让你在本地用 AI 批量翻译项目 Markdown 文档，双栏对照原文阅读，告别上下文切换。

![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)
![Electron](https://img.shields.io/badge/Electron-28-47848F?logo=electron)
![License](https://img.shields.io/badge/license-MIT-green)

---

## 功能特性

- **批量翻译** — 一键将项目内所有 Markdown 文件加入翻译队列，支持自定义并发数
- **优先级插队** — 点击单个文件立即优先翻译，无需等待队列
- **双栏对照** — 左栏原文、右栏译文同屏对比，滚动联动同步
- **增量更新** — 记录每个文件的 sha256 Hash，源文件修改后自动标记为"需更新"
- **断点续翻** — 重新打开同一项目时跳过文件复制，直接恢复上次未完成的翻译任务
- **手动校对** — 双击译文进入编辑模式，失焦自动保存并更新 Hash
- **兼容任意 OpenAI 接口** — 支持自定义 Base URL，可接入 OpenAI、DeepSeek、Moonshot 等任意兼容接口
- **日间 / 夜间主题** — 一键切换，偏好持久化到本地

## 截图

![img_1.png](img_1.png)
![img_2.png](img_2.png)

## 下载安装

前往 [Releases](../../releases) 页面下载对应平台的安装包：

| 平台 | 文件 |
|------|------|
| macOS (Apple Silicon / Intel) | `OpenTrans-x.x.x.dmg` |
| Windows | `OpenTrans-Setup-x.x.x.exe` |
| Linux | `OpenTrans-x.x.x.AppImage` / `.deb` |

### macOS 安装步骤

1. 下载 `OpenTrans-x.x.x.dmg` 文件
2. 双击打开 DMG 镜像
3. 将 `OpenTrans.app` 拖入 `Applications` 文件夹
4. **重要**：如果遇到"应用已损坏"提示，请按以下步骤修复：

#### 方法一：使用修复脚本（推荐）

在 DMG 窗口中找到 `fix-macos.command`，双击运行，按提示输入密码即可。

#### 方法二：手动修复

打开"终端"应用，输入以下命令：

```bash
sudo xattr -r -d com.apple.quarantine /Applications/OpenTrans.app
```

输入开机密码后回车，然后即可正常打开 OpenTrans。

> **为什么会出现"已损坏"提示？**
> 这是 macOS Gatekeeper 安全机制。由于 OpenTrans 暂未通过 Apple 签名和公证，系统会将其标记为"未知来源"。上述命令会解除这个限制，对应用本身没有任何影响。

### Windows 安装

双击 `OpenTrans-Setup-x.x.x.exe`，按向导完成安装即可。

### Linux 安装

**AppImage 方式：**
```bash
chmod +x OpenTrans-x.x.x.AppImage
./OpenTrans-x.x.x.AppImage
```

**Debian/Ubuntu (.deb)：**
```bash
sudo dpkg -i OpenTrans-x.x.x.deb
sudo apt-get install -f  # 修复依赖
```

## 快速上手

1. 打开 OpenTrans，点击右上角 **⚙ 设置**，填入 API Base URL、API Key 和模型名称
2. 点击 **选择项目**，选择一个包含 `.md` 文件的本地目录
3. 程序会在同级目录创建 `{项目名}-translator/` 作为工作目录
4. 点击 **全量翻译** 将所有未翻译文件加入队列；或点击左侧文件树中的单个文件立即优先翻译
5. 右栏译文翻译完成后，双击可进入编辑模式手动校对，失焦自动保存

### 文件状态说明

| 图标颜色 | 含义 |
|----------|------|
| 🟢 绿色  | 已翻译 |
| ⚫ 灰色  | 待翻译 |
| 🔵 蓝色  | 源文件已修改，需重新翻译 |
| 🟡 黄色  | 翻译中 |
| 🔴 红色  | 翻译失败 |

## 本地开发

```bash
# 克隆仓库
git clone https://github.com/CoderXiaopang/opentrans.git
cd opentrans

# 安装依赖
npm install

# 启动开发模式
npm run dev
```


## 技术栈

| 层 | 技术 |
|----|------|
| 运行时 | Electron 28 |
| 前端 | React 18 + Tailwind CSS v3 |
| 构建 | electron-vite + Vite 5 |
| 状态管理 | Zustand |
| Markdown 渲染 | markdown-it |
| 翻译并发 | Worker Threads |
| 打包 | electron-builder |

## 常见问题

### macOS 相关

**Q: 提示"OpenTrans 已损坏，无法打开"怎么办？**

A: 这是正常的 macOS 安全提示。按照[安装步骤](#macos-安装步骤)中的修复方法解决即可。

**Q: 运行修复脚本后还是无法打开？**

A: 请确保：
1. 应用已拖入 `/Applications` 文件夹
2. 修复命令中的路径正确
3. 输入了正确的管理员密码

如仍有问题，可以尝试重新下载 DMG 文件。

**Q: 修复脚本找不到应用怎么办？**

A: 新版修复脚本会自动搜索常见位置。如果仍找不到，请手动运行：
```bash
sudo xattr -r -d com.apple.quarantine /path/to/OpenTrans.app
```
（将 `/path/to/OpenTrans.app` 替换为实际路径）

### 权限相关

**Q: 提示"初始化失败: EACCES: permission denied"怎么办？**

A: 这通常是目录权限问题。解决方法：
1. 选择一个你有完全读写权限的目录作为项目位置
2. 避免选择系统保护目录（如 `/System`、`/Library` 等）
3. 推荐使用 `~/Documents` 或 `~/Desktop` 下的目录

**Q: macOS 提示"OpenTrans 想要访问文件夹"？**

A: 这是正常的权限请求。请点击"允许"以便 OpenTrans 读取和翻译项目文件。

### 使用相关

**Q: 支持哪些 Markdown 文件？**

A: 支持所有 `.md` 扩展名的 Markdown 文件，包括子目录中的文件。

**Q: 翻译速度很慢怎么办？**

A: 可以在设置中调整并发数。建议值：
- 免费 API：1-2
- 付费 API：3-5
- 本地模型：根据硬件性能调整

**Q: 如何切换不同的 AI 模型？**

A: 在设置中填入对应的 API Base URL 和 API Key：
- **OpenAI**: `https://api.openai.com/v1`
- **DeepSeek**: `https://api.deepseek.com`
- **Moonshot**: `https://api.moonshot.cn/v1`
- **其他兼容接口**: 填入对应的 Base URL

**Q: 可以导出翻译结果吗？**

A: 翻译完成后，所有译文都保存在 `{项目名}-translator/` 目录中，与原文件保持相同的目录结构。

## 许可证

[MIT](LICENSE)
