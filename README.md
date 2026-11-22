# DeepSeek 对话 · iOS

一个只做聊天的 iPhone 应用：DeepSeek 官方接口、流式输出、思考过程、多段历史对话、图片/语音/文件附件。
备忘录功能不需要——苹果自带备忘录就够了，这个 App 专心做对话。

## 成品

- 构建产物：`WristNote.ipa`（GitHub Actions macOS 自动构建，未签名，交给全能签）
- 包名：`com.wristnote.app`
- 显示名：DeepSeek 对话
- 版本：1.0.0（CFBundleVersion 1）
- 最低系统：iOS 15.0，arm64

## 功能

### 对话

- 一次性请求 /chat/completions（和安卓端一致，最稳），等待时显示思考中
- 思考过程折叠：回复上方 `▸ 思考过程`，展开看 `reasoning_content`
- Markdown 渲染：标题、列表、表格、代码块、行内代码、粗体/斜体/删除线、引用、链接只留文字、LaTeX 括号还原
- 推理强度：`off / low / high / max`；off 只发 `thinking:disabled`，不发 `reasoning_effort`
- 模型：`deepseek-flash` / `deepseek-chat` / `deepseek-reasoner` / 自定义
- 两种模式：普通（纯模型）、大肥鱼（人设）
- 余额、上下文圆环、缓存命中率
- 长按消息：复制 / 重改 / 删除；AI 回复可重新生成
- 发送中可点停止

### 附件

- 图片：相册选择，自动压到 1600px，base64 走视觉输入
- 语音：录音 → 停止 → 调 ASR 转文字 → 和消息一起发送
- 本机文件：文件 App 选择，走 Files API 上传后以 `file_id` 发送

### 历史对话

- 左滑消息区（或左上角列表按钮）打开抽屉
- 搜索标题和对话正文
- 置顶 / 今天 / 昨天 / 7 天内 / 更早 分组
- 每行：⋯ 菜单、归档、置顶；已归档（N）切换
- 重命名、删除、清空当前对话

### 设置

- 模型、推理强度、账户余额、API Key、接口地址
- 外观：跟随系统 / 浅色 / 深色
- 诊断日志开关与查看（复制 / 清空，崩溃记录置顶）
- 版本号、联系我

## 技术结构

| 层 | 说明 |
| --- | --- |
| `ios/WristNote/*.swift` | WKWebView 壳、安全区/键盘、原生桥、录音、相册、文件、SSE 流式 HTTP、日志 |
| `ios/WristNote/www/` | 界面与业务：HTML/CSS/JS（对话、抽屉、设置、Markdown、首次填 Key） |
| `build.sh` | `swiftc` 编 arm64，拼 `.app`，打包成 IPA |
| `.github/workflows/ipa.yml` | macOS runner 自动构建并上传 IPA |

## 构建

推送 `main` 自动构建，产物在 Actions 的 `WristNote-ipa` artifact（zip 里是 `WristNote.ipa`）。
本地 macOS 也可以 `bash build.sh`。

## 安装（全能签）

1. 下载 `WristNote.ipa`
2. 全能签 → 导入 → 选证书签名（包名保持 `com.wristnote.app`，或按证书改）
3. 首次录音会要麦克风权限；第一次发消息前先去「设置」填 API Key

## 数据

| 内容 | 位置 |
| --- | --- |
| 设置 | `data/db.json` |
| 对话 | `data/chats/<id>.json` |
| 图片/文件 | `images/*.jpg`、`files/*` |
| 语音 | `audio/*.wav` |
| 日志 | `diagnose.log`、`crash.txt` |

应用开了文件共享，可在 Files → 我的 iPhone → DeepSeek 对话 里看到并备份。

## 说明

- 没有做备忘录/编辑器/语音备忘/回收站：需求改成只做聊天，苹果自带备忘录
- 版本号从安卓的 0.7.9 改成 iOS 的 1.0.0
- 数据从空白开始，不迁移
