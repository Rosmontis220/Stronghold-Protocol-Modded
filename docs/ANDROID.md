# Android 客户端

项目使用 Capacitor 将现有网页客户端封装为 Android 应用。Android 端加载线上客户端页面，因此和网页、Windows EXE 使用同一套联机协议、资源预下载、选择性下载与本地资源导入逻辑。

## 环境

- JDK 21+
- Android SDK，建议安装 Android 36 和 Build Tools 36.1.0
- 可访问 Gradle、Google Maven 和 Maven Central

## 构建

在 `Stronghold-Protocol-Modded` 目录执行：

```powershell
npm install
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

APK 输出：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

也可以从根目录执行：

```powershell
npm run mobile:apk
```

Android Studio 打开工程：

```powershell
npm run mobile:open
```

## 服务器地址

默认服务器在 [capacitor.config.ts](../capacitor.config.ts) 中设置为：

```text
https://wsxy.rosmontis220.top
```

如果要切换测试服务器，修改 `server.url` 后重新运行 `npx cap sync android`。客户端的 WebSocket 地址会依据页面地址自动使用 `wss://`。

## 当前本机状态

Capacitor Android 工程已经生成，Gradle Wrapper 和 SDK 配置可用。若本机无法访问 Google Maven，Gradle 会在解析 AndroidX/Cordova 依赖时失败；联网后重新执行上面的构建命令即可，不需要改代码。
