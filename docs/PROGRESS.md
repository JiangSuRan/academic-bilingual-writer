# 任务进度与恢复指南

> 更新:2026-11-12 第二轮会话结束 · 项目状态:**全部验收标准达成,任务完成**
> 项目位置:`D:\tools\AcademicBilingualWriter` · 安装包:`releases/Academic Bilingual Writer_0.1.0_x64-setup.exe`

## 一、验收标准对照(需求第十三节)

| # | 验收场景 | 结果 |
|---|---|---|
| 1 | 启动程序并创建新文稿 | ✅ |
| 2 | 输入中文医学内容 | ✅(含统计信息段落) |
| 3 | 调用已配置模型生成英文 | ✅ 本地 Hunyuan-MT 真实流式回路 |
| 4 | 直接修改右侧英文 | ✅ 标记「英文已人工编辑」 |
| 5 | 修改左侧中文不覆盖原英文 | ✅ 旧英文保留 + 状态标记 |
| 6 | 指定段落重译并确认替换 | ✅ 待确认缓冲,替换/保留两路径 |
| 7 | 一键复制英文到 Word | ✅ 系统剪贴板纯文本验证 |
| 8 | 关闭重开内容完整 | ✅ 强杀进程后自动恢复(含安装版) |
| 9 | 网络失败不丢内容 | ✅ 失败状态+错误横幅,中英文零丢失 |
| 10 | 完成安装包构建 | ✅ NSIS 2.95 MB,静默安装+启动验证通过 |

详见 `docs/TESTING.md`(13 项 E2E + 34 项自动化测试)。

## 二、环境与遗留事项

1. **打包前检查已完成**:tauri.conf.json 无任何调试参数(CDP 端口仅在 dev 联调时临时加回)。
2. **保存对话框为 rfd 直连**(弃用 tauri-plugin-dialog,该插件在本机 save 挂起):`src-tauri/src/commands.rs` 的 `pick_open_path`/`pick_save_path`;rfd 0.17 链式配置必须在 `save_file()/pick_file()` 终结方法之前。
3. **提示词布局**:场景/术语表/上下文在 system 消息,user 只含【正文】(弱模型会把 user 内的标签一起"翻译",实测修正)。
4. **git 已初始化并提交**;后续改动正常提交即可。
5. **本机便利配置**(保留):应用内置两个模型配置(OpenAI 预设 + 本地 `http://127.0.0.1:8899/v1` + hunyuan-mt-7b);凭据管理器中已存一个本地测试 Key(`p-default.AcademicBilingualWriter`,值为占位符,不影响安全,可在设置中删除)。
6. 本地测试模型启动命令:`D:\tools\llama.cpp\llama-server.exe -m /d/tools/hunyuan-mt/Hunyuan-MT-7B-q4_k_m.gguf -ngl 99 -c 4096 -np 2 --port 8899`。
7. **CDP 调试方法**(仅 dev):在 tauri.conf.json 窗口配置临时加 `"additionalBrowserArgs": "--remote-debugging-port=9222"`,用 `scripts/dev/cdp.mjs`(eval/evalf/shot)驱动;`scripts/dev/shot-window.ps1` 可截原生窗口(无需 CDP)。
8. dev-only 调试钩子:`window.__abw.store`(仅 `import.meta.env.DEV` 下注入,生产构建静态消除)。

## 三、可迭代方向(非本版范围)

- 段落上移/下移按钮(ID 机制已支持,仅缺 UI 入口)
- 术语表批量导入(CSV)
- 深色主题细节打磨
- 可选代理支持(当前强制直连)
- 代码签名证书(消除 SmartScreen 提示)
