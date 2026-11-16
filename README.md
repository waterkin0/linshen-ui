# 林深时见鹿

A third-party SillyTavern extension for DeerTavern. It provides a forest-toned reading workspace and shows the fork's background generation state near the composer.

Project repository: [github.com/waterkin0/linshen-ui](https://github.com/waterkin0/linshen-ui)

## Features

- Replaces the spread-out header with one compact, left-aligned control rail for the brand, selected World Book, tools, and connection state.
- Keeps conversation text in a centered single reading column.
- Opens World Book settings from the header selector.
- Opens Tools & settings in a two-column dialog with categories on the left and controls on the right.
- Offers English, Simplified Chinese, and system language options in the dialog.
- Applies a forest-ink visual layer while preserving the active SillyTavern theme, character art, and user background.
- Adds a task status strip for active generation, offline state, and recoverable answers for the current chat.
- Uses the built-in recovery confirmation flow. It does not create a second resume or cancel flow.
- Marks Horde generation as foreground-only and explains that the page must remain open.
- Removes its UI and event handlers when the extension is disabled.

## Use

This extension ships in `public/scripts/extensions/third-party/linshen-ui`. After reloading, it appears in the Extensions panel and loads unless it has been disabled there. Disable it and reload to return to the original interface.

Background task messaging follows the current server support: OpenAI chat completions, Text Generation WebUI, NovelAI, and Kobold. If the server restarts, only saved partial output can be restored.


## Troubleshooting

The extension loads from `/scripts/extensions/third-party/linshen-ui/index.js`. If the browser reports a different folder name, remove the stale copy from the Extensions panel and reload the frontend.

## 使用方式

扩展位于 `public/scripts/extensions/third-party/linshen-ui`。刷新前端后，它会以「林深时见鹿」出现在「扩展」面板中，并在未被停用时自动加载。如需恢复原界面，可停用该扩展并刷新页面。

项目仓库：[github.com/waterkin0/linshen-ui](https://github.com/waterkin0/linshen-ui)

顶栏入口会打开世界书设置，并显示当前已选世界书。点击「工具与设置」会打开双栏弹窗：左侧切换类别，右侧显示对应内容。


后台任务状态支持 OpenAI 聊天补全、Text Generation WebUI、NovelAI 和 Kobold。服务器重启后，只能恢复重启前已保存的部分输出。

## 加载错误排查

默认语言跟随浏览器系统语言；也可在「工具与设置」的「界面语言」中选择简体中文或 English。扩展脚本地址为 `/scripts/extensions/third-party/linshen-ui/index.js`。如果报错地址中的目录名不同，可在「扩展」面板删除旧副本，再刷新前端。
