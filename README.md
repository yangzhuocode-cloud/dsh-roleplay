# 角色扮演 · Roleplay

<img src="./icon.png" alt="角色扮演：大肥鱼图标" width="128" height="128" />

DeepSeek Harness 的本地人设卡、口吻调整和梗百科。需要 DSH 0.2.2-rc.3 与 Node 24。三项功能都在「设置 → 角色扮演」。

- 人设卡：每张卡旁可设为默认、编辑或删除，配套卡可直接换头像。打开角色扮演后可配置场景、约定、开场白和扮演示例。关闭角色扮演会保留填写过的内容。
- 动作与旁白：开场白和示例里用独立的 Markdown 斜体段写动作，用中文双引号标记对白。关掉「带动作与旁白」后，新对话读取标记过的对白。无法区分旧开场白的动作与对白时，由用户先开口。
- 去八股：日常聊天使用原版人味提示和人设卡。减少套话是单独的开关，已保存的旧档位 1–3 都视为开启。贴近台词按档位选 0–3 组对话示例。文本试改使用原版规则处理给定文本，独立设置力度、种子和语病层，不改写已发送的消息。
- 梗百科：启用后提供本地查询工具。自动查梗另行控制回复前的词条预查。两页的聊天设置用于新会话，已有会话使用各自的开局配置。
- 词库：本地 SQLite 查询与预查，先查自定义词条，再查社区词库。自定义词库可编辑或导入 JSON 数组，词名和释义必填，变更用于下一次查询。

上述日常修改无需重启 DSH。会话绑定与词库保存在 `DSH_HOME/quyubagu/state.json`。分支继承原会话的人设快照。卡片 JSON 与会话记录分开导出。开场白写入 DSH 对话历史，无需请求模型。用户回复时，开场白作为 assistant 消息进入上下文。

## 接入本地社区词库

插件读取 `DSH_HOME/quyubagu/memes.db`，也可用环境变量 `DSH_QUYUBAGU_MEME_DB` 指向现有的 `data/memes.db`。社区库只读，代码包与词库数据分开。加入或更新默认位置的库文件后，下次查询时会重新识别。社区库缺失或不可读取时，自定义词条仍然可用。梗百科页显示社区库状态和词条数。

## 配套人设卡

依次内置大肥鱼、Claude大小姐和猫娘。三张卡都带头像、普通聊天示例、扮演示例和两条开场白，可在卡库里直接编辑。

中文对白、扮演示例与头像均由本插件编写和生成。

## 名称与旧数据兼容

发布包名为 `dsh-roleplay`，中文显示名为「角色扮演」。为保留本地试用数据，当前仍使用 `DSH_HOME/quyubagu` 数据目录、`DSH_QUYUBAGU_MEME_DB` 环境变量和原卡片格式。请先卸载旧的 `dsh-quyubagu` 再安装本包，不要同时启用两个版本。

本项目以 MIT 许可开源。第三方代码及其许可见 `THIRD_PARTY_NOTICES.txt` 和 `vendor` 内的许可证。

## 安装

需要 DSH 0.2.2-rc.3 和 Node.js 24 或更高版本。桌面版使用 `desktop` 配置：

```sh
dsh plugin --profile desktop add github:yangzhuocode-cloud/dsh-roleplay
```

安装后重启 DSH，在「设置 → 角色扮演」中使用。Web 版将 `desktop` 改为 `web`。安装旧版 `dsh-quyubagu` 的用户应先卸载旧插件；保留 `DSH_HOME/quyubagu` 中的个人数据。卸载可在 DSH 插件管理页中操作。

安装包也可通过 `dsh plugin --profile desktop add "file:/绝对路径/dsh-roleplay-0.2.0.tgz"` 本地安装。

## 开发

```sh
npm run check
npm test
dsh plugin --profile web add "link:/absolute/path/to/dsh-roleplay"
dsh web
```

## 隔离测试

`fixture-model.mjs` 提供仅绑定到环回地址的测试模型。用独立的 DSH_HOME 启动 Web 版，将 DEEPSEEK_BASE_URL 指到测试模型的端口，并使用占位 API Key。
浏览器测试运行 `node browser-check.mjs <隔离测试目录>`，该目录需要 DSH 启动日志 web-fixture.log、测试模型请求记录 fixture.ndjson，以及在 browser-tools 下安装的 playwright-core。默认使用 Windows Chrome，可用 DSH_TEST_CHROME 指定路径。
