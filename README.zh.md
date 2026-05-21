# NimbleTools for macOS

> NimbleTools 是一个隐私优先的 macOS 桌面工具箱。
> Windows 版本请访问：[nimbletools.jea.ink](https://nimbletools.jea.ink/)

[English](./README.md) | [隐私说明](./PRIVACY.md) | [Privacy Policy](./PRIVACY.en.md)

## 当前状态

这个仓库当前只面向 **macOS**，没有提供可直接下载的安装包。

当前使用方式是从命令行自行启动开发版：

```bash
npm install
npm run tauri dev
```

## 项目定位

NimbleTools 是一个基于 Tauri 2、React、TypeScript 和 Rust 构建的本地桌面工具箱。它把图片处理、文件处理、文本编码、截图标注、剪贴板历史、curl 请求调试等常用能力放在一个桌面应用里。

默认设计原则是：

- 尽量在本机处理数据。
- 不内置账号系统。
- 不内置遥测、统计或广告 SDK。
- 不把剪贴板、截图、文件内容自动上传到远端服务。

例外也要说清楚：`Curl 请求` 工具会在你主动发送请求时访问你填写的 URL；`打开链接`、系统 OCR、文件选择、剪贴板访问、屏幕截图等能力会调用对应的系统 API。

## 功能

### 图片处理

- 图片格式转换：JPG、PNG、WebP、BMP。
- 图片尺寸调整：按像素或百分比缩放。
- 图片质量压缩：调整 JPEG 压缩质量。
- 图片拼接：水平或垂直拼接多张图片。
- 图片水印：添加文字水印。

### 文件工具

- 文件拆分：按大小或数量拆分文件。
- 文件合并：合并分卷文件，并支持 CRC32 校验。
- 批量重命名：前缀、后缀、查找替换、正则、序号命名和实时预览。

### 文本与编码

- OCR 识别：使用 macOS Apple Vision。
- Base64 编解码。
- JSON / XML 格式化、压缩和校验。
- URL 编解码。
- 正则测试。
- 文本统计。

### 实用工具

- 二维码生成。
- 单位转换。
- 颜色拾取。
- 时间戳转换。
- Hash 校验。
- UUID 生成。
- 密码生成。
- 进制转换。
- Curl 请求工作台。
- 剪贴板历史。

### 截图标注

- 屏幕截图。
- 区域选择。
- 标注编辑：画笔、矩形、椭圆、箭头、直线、文字。
- 保存或复制标注后的图片。

macOS 上部分功能需要系统授权：

- 剪贴板历史和快捷粘贴需要剪贴板/辅助功能相关权限。
- 截图功能需要屏幕录制权限。
- OCR 使用系统 Vision Framework。

## 环境要求

- macOS 12.3 或更新版本。
- Node.js 18 或更新版本。
- Rust stable。
- Tauri 2 所需的系统依赖。

推荐先确认：

```bash
node --version
npm --version
rustc --version
cargo --version
```

## 本地启动

```bash
git clone git@github.com:jea-tools/nimbletools.git
cd nimbletools
npm install
npm run tauri dev
```

这个仓库目前没有提供一键安装包。`npm run tauri dev` 会同时启动 Vite 和 Tauri 开发进程。

## 构建

macOS 本机构建：

```bash
npm install
npm run tauri build
```

构建产物会生成在 `src-tauri/target/release/bundle/` 下。

## 技术栈

- Tauri 2
- React 19
- TypeScript
- Vite
- Rust
- rusqlite
- reqwest
- arboard
- lucide-react
- react-i18next

## 数据和隐私

详细说明见 [PRIVACY.md](./PRIVACY.md)。

简要说明：

- 剪贴板历史保存在本机应用数据目录中的 SQLite 数据库。
- Curl 项目、请求和历史记录保存在本机应用数据目录中的 SQLite 数据库。
- 截图、图片、文件处理默认使用本地文件和系统临时/缓存目录。
- 应用没有内置遥测、广告或账号系统。

## 开源前注意

不要提交这些内容：

- `node_modules/`
- `dist/`
- `src-tauri/target/`
- 本地 `.env*`
- 数据库、日志、截图缓存、打包产物
- 证书、签名文件、私钥、发布配置

本仓库已经提供根目录 `.gitignore` 来排除这些内容。

## 许可证

MIT
