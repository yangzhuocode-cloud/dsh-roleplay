# 角色扮演 · Roleplay

<img src="./icon.png" alt="角色扮演：大肥鱼图标" width="128" height="128" />

为 DeepSeek Harness 添加人设卡、角色开场白、口吻调整和本地梗百科。

- **人设卡**：自建、编辑、导入角色，设置默认人设、场景、开场白和对话示例。
- **去八股**：减少套话，调整角色口吻；通过「文本试改」预览修改效果。
- **梗百科**：查询本地词条，可开启自动查梗，并添加自己的释义。

## 安装

本地实测：DSH 0.2.2-rc.3、Node.js 24。其他 DSH 版本尚未验证；当前安装包的兼容声明限定为 DSH 0.2.2-rc.3。Node.js 要求为 24 或更高版本。

桌面版安装：

```sh
dsh plugin --profile desktop add github:yangzhuocode-cloud/dsh-roleplay
```

也可在 DSH「插件 → 添加插件」中输入：

```text
github:yangzhuocode-cloud/dsh-roleplay
```

安装后重启 DSH，打开「设置 → 角色扮演」。Web 版将命令中的 `desktop` 改为 `web`。

## 使用

### 人设卡

内置大肥鱼、Claude大小姐和猫娘，均可直接编辑。也可新建人设卡或导入卡片 JSON。

将一张卡设为默认后，新会话会使用该人设。开启角色扮演后，可填写场景、约定和开场白；开场白会保存在聊天记录中。

「带动作与旁白」控制是否包含动作描写。编写开场白和示例时，用独立的 Markdown 斜体段落写动作，用中文双引号标记对白。

### 去八股

可调整减少套话和贴近台词等选项。「文本试改」提供独立预览，不会修改已发送的消息。

### 梗百科

可添加自定义词条或导入 JSON 数组，词名和释义必填。自定义释义优先，保存后下一次查询生效。

人设和聊天设置的调整用于新会话，已有会话保留开局配置。日常设置修改无需重启 DSH。

## 可选社区词库

社区词库不随插件分发。将 SQLite 词库放到 `DSH_HOME/quyubagu/memes.db`，或通过环境变量 `DSH_QUYUBAGU_MEME_DB` 指定文件路径。

插件只读社区词库，梗百科页会显示接入状态和词条数。未接入社区词库时，仍可使用自定义词条。

## 开发

```sh
npm run check
npm test
```

## 许可

本项目使用 [MIT 许可](./LICENSE)。第三方代码声明见 [THIRD_PARTY_NOTICES.txt](./THIRD_PARTY_NOTICES.txt)，对应许可证保留在 `vendor` 目录。
