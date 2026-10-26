# 开发与贡献

需要 Node.js 22 或更新的受支持版本。Windows 原生组件使用系统 .NET Framework C# 编译器；Apple Silicon Mac 需要 Xcode Command Line Tools。

```sh
npm ci
npm test
npm run audit:public
```

本机开发前先执行对应的 `npm run native:win` 或 `npm run native:mac`，再执行 `npm start`。测试使用模拟显示器和临时配置；Mac 专用原生校验用例只在 macOS 运行。`npm run diagnose` 会输出硬件标识，结果存入被 Git 忽略的 `artifacts/`，请勿原样上传。

## 目录

| 目录 | 内容 |
| --- | --- |
| `src/` | Electron 主进程、局域网协议、显示器与剪贴板逻辑 |
| `src/ui/` | 精简模式、完整工作空间和托盘面板 |
| `native/windows/` | Windows DDC 与 Logitech HID 控制组件 |
| `native/macos/` | Apple Silicon DDC 与 Logitech HID 控制组件 |
| `vendor/m1ddc/` | 固定版本的 MIT 授权 DDC 依赖 |
| `tests/` | 状态、配对、切换、剪贴板、快捷键与键鼠跟随回归测试 |
| `scripts/` | 构建、诊断、发布与公开内容检查 |

## 提交与验证

保持硬件写入与只读检测边界明确。发送 DDC / HID 指令不等于切换成功，应保留目标状态回读；不要在测试中擅自切换真实显示器或键鼠。复现问题优先使用模拟后端。

提交前检查 `git diff --cached`，避免加入设备名称、用户目录、内网地址、配对凭据和真实复制内容。测试数据使用虚构名称。提交邮箱可使用 GitHub 的 noreply 地址。

Windows 运行中的程序不能直接覆盖资源包。构建后可使用 `scripts/install-win.ps1 -BuildPath <构建目录>` 停止旧版本、校验并安装；这会重启应用。

## 发布

1. 更新版本、产品说明和变更记录。
2. 在 Windows 和 Apple Silicon Mac 原生构建，运行适用测试。
3. 运行 `npm run audit:public`，检查 Git 暂存区与已跟踪文件。
4. 使用 `node scripts/package-delivery.cjs source` 从 Git 暂存区的文件清单生成源码包；工作区中未提交的个人文件不在此清单中。
5. Windows ZIP 包含完整应用目录；Mac ZIP 包含 `.app`。为附件生成 SHA-256 文件，检查压缩包内部后上传 Release。

不要把测试完成描述成广泛硬件兼容保证。未签名／未公证的包应在发布说明中注明。
