<p align="right"><a href="README.md">English</a> · <strong>简体中文</strong></p>

![Automatic Twitch — 专心看直播，奖励自动领](docs/assets/banner.svg)

<h1 align="center">Automatic Twitch (Manifest V3)</h1>

<p align="center">自动领取 Drops 与频道奖励积分，每次领取都有记录。<br>专心看喜欢的直播，奖励交给 Automatic Twitch。</p>

<p align="center">
  <a href="https://github.com/shockbladenull/automatic-twitch-manifest-v3/releases/latest"><strong>下载最新版本</strong></a> ·
  <a href="#安装">安装指南</a> ·
  <a href="https://github.com/shockbladenull/automatic-twitch-manifest-v3/issues">反馈问题</a>
</p>

> [!NOTE]
> **基于 EbNull 的 Automatic Twitch 二次开发。** 原项目为 [EbNull](https://ebnull.org/) 创作的 **Automatic Twitch: Drops, Moments and Points**。本项目独立维护，将其适配至 Manifest V3。[原扩展](https://chromewebstore.google.com/detail/automatic-twitch-drops-mo/kfhgpagdjjoieckminnmigmpeclkdmjm) · [归属与授权](THIRD_PARTY_NOTICES.md)。

## 功能

### Drops 达成条件，自动领取

观看支持 Drops 的直播，完成奖励条件后，扩展会检查 Twitch 库存并自动提交可领取的奖励。省去反复打开库存页面、逐项点击“领取”的操作，让你专心观看直播。

### 频道奖励积分，顺手收下

不用一直盯着奖励宝箱。出现可领取的频道积分奖励时，Automatic Twitch 会替你领取，并记录获得的积分。Drops 和频道积分分别提供开关，按需开启其中一项或两项。

### 收获了什么，一目了然

打开扩展即可查看最近的领取记录与累计统计。按奖励类型筛选，查看领取时间以及对应的游戏或频道。记录只统计扩展实际领取的奖励，方便了解它为你收下了什么。

### 提醒方式，由你决定

为不同奖励分别选择页面弹窗、声音、桌面通知，或将它们组合使用。声音音量与弹窗停留时间均可单独调整，并可通过内置测试提醒预览效果。让 Drops 醒目些，让常规积分领取安静些，随你设置。

自动领取默认开启，直接使用你已有的 Twitch 登录状态。偏好设置集中在扩展弹窗中，随时可通过总开关暂停自动化。设置与领取记录保存在本机。

## 安装

1. 从 [Releases](https://github.com/shockbladenull/automatic-twitch-manifest-v3/releases/latest) 下载扩展 ZIP。
2. 解压到准备长期保留的文件夹。
3. 打开 `chrome://extensions`，开启“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择解压后包含 `manifest.json` 的 `automatic-twitch-manifest-v3` 文件夹。
5. 打开 Twitch，刷新已有的直播标签页，开始观看。

**需要 Chrome 116 或更高版本。** Release ZIP 解压后即可加载，无需构建工具或额外下载。

将 Automatic Twitch 固定到工具栏，即可随时查看领取记录、统计与设置。

新版本发布后，将新文件解压到同一个扩展文件夹，在 Chrome 中点击“重新加载”，并刷新 Twitch 页面。

## 参与贡献

欢迎反馈问题、提交修复或改进。开发环境、测试和 Release 发布方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。

维护者：[shockbladenull](https://github.com/shockbladenull)。
