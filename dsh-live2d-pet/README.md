# dsh-live2d-pet

给 DeepSeek Harness 用的 **Live2D 桌面宠物**：把 [鲸语](https://github.com/InariNGT-Ofiicial/jingyu-live2d-agent) 的动作工作台裁成一块透明浮窗，停在桌面上，并给 AI 一组工具让她说话、抬眼、点头、换表情。

> **模型自备。** 这个包不含任何 Live2D 模型文件。示例里的「大肥鱼」公皮许可明确禁止重新分发，只允许个人使用与二创——所以你想用自己的皮，请按作者要求署名、自己放模型。

## 0.2.0 改了什么

- **设置页**（设置 → 桌宠）：大小、不透明度、头像、视线跟随、待机开关与节奏、气泡停留、九个待机动作勾选、一个都不勾 = 全开。
- **动作试玩**：23 个表情 + 3 套手势 + 几组常用组合，点一下就在桌面上做一次；还有一个「说一句」输入框。
- **四个新接口**：`/config`、`/apply`、`/perform`、`/say`（旧的三个还在）。
- 外壳开始读 `shell/pet-settings.json`；待机动作可被白名单过滤；气泡时长可配。
- 修了一个真问题：工具输出 schema 里嵌套对象没写 `additionalProperties`，会让整个插件的 `apply()` 在中途抛错、后面的 HTTP 路由挂不上（表现是"插件装了但接口 404"）。现在工具注册包在 try/catch 里，挂了也不影响路由。

## 分工

| 谁 | 干什么 |
| --- | --- |
| 鲸语 `jingyu-live2d-agent` | 渲染、动作编译、物理、口型（别人的开源项目） |
| 本插件 | 起外壳、写气泡与聊天文件、把动作计划 POST 给鲸语、提供 4 个工具 |
| 你的模型 | 你自己买的/别人授权的 `.moc3` + `model3.json` |

本插件**不打包**鲸语的代码，也不打包模型；它只是驱动已经跑起来的舞台。

## 装之前

1. **鲸语要能跑**：[jingyu-live2d-agent](https://github.com/InariNGT-Ofiicial/jingyu-live2d-agent) 按它的 README 起来，`http://127.0.0.1:61942/` 打得开，模型能显示。
2. **Electron**：DSH 桌面版自带（`$DSH_HOME/electron/electron.exe`），没有就装一个，用 `electron` 字段指过去。
3. **DSH** ≥ 0.2.0-rc.2（在 0.2.1-rc.5 上测过）。

## 装

```bash
# 本地目录
dsh plugin --profile desktop add file:/path/to/dsh-live2d-pet

# 或者从 npm（发布后）
dsh plugin --profile desktop add dsh-live2d-pet
```

装完重启 DSH，工具就出现在列表里：

- `live2d_pet_status` —— 外壳在不在跑、舞台通不通、模型叫什么
- `live2d_pet_say` —— 让她冒一句话（气泡 9 秒）
- `live2d_pet_perform` —— 一组动作：抬眼/点头/摇头/偏头/笑/眨眼/表情/手势，可带一句台词
- `live2d_pet_restart` —— 重启外壳

## 设置页（不用开终端）

装好之后 DSH 的 **设置 → 桌宠** 里有一页，能改的东西都在里面：

**状态**
- 三条：舞台（在线 / 画面是否就绪 / 几个窗口连着）、宠物窗（在跑 / pid）、启动脚本（配了没、文件在不在）
- 三个按钮：**全部拉起**（先跑你配的 `launchScript`，没配就只起宠物窗）、**只重启宠物窗**、刷新（每 5 秒自己也会刷一次）

**外观**
| 参数 | 范围 | 说明 |
| --- | --- | --- |
| 宽度 | 260–900 px | 高度按 435:664 自己算；屏幕装不下会自动收 |
| 不透明度 | 0.25–1 | 想让她更「贴」桌面就调低 |
| 头像图片 | 本机路径 | 左上角那颗圆图标，png/jpg/webp；留空用内置的 |

**行为**
| 参数 | 默认 | 说明 |
| --- | --- | --- |
| 视线跟随 | 开 | 鼠标动的时候她会看过去 |
| 待机小动作 | 开 | 没人理她的时候自己动 |
| 待机最短间隔 | 22 秒 | 8–300 秒 |
| 随机范围 | 45 秒 | 在最短间隔上再加 0–N 秒 |
| 气泡停留 | 9 秒 | 1–60 秒 |
| 允许的待机动作 | 全开 | 九个待机动作可逐个勾选；一个都不勾 = 全开 |

**启动**
| 参数 | 说明 |
| --- | --- |
| 舞台地址 | 鲸语的地址，端口不对就改这里 |
| Electron 路径 | 留空则找 `$DSH_HOME/electron/electron.exe` 与 PATH |
| 启动脚本 | 点「全部拉起」时先跑它（`.ps1` / `.cmd`），适合把舞台和回话器一起拉起来 |
| 开机自启 | DSH 启动时自动把宠物窗拉起来 |

**动作**：23 个表情、3 套手势（举手 / 竖手指 / 狗尾草）、几组常用组合（抬眼笑、偏头眨眼、点头、摇头、说话+脸红），点一下就在桌面上做一次；还有一个「说一句」的输入框。

改完点 **保存并套用**：写配置 → 写 `shell/pet-settings.json` → 重启一次外壳（舞台不动）。只想存着不重启就点 **只保存**。

后端接口（都要求本机同源 + 过 DSH 信任栅栏）：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/live2d-pet/status` | 状态 + 当前配置 + 动作清单 |
| POST | `/api/live2d-pet/start` | 跑 `launchScript`，或直接起宠物窗 |
| POST | `/api/live2d-pet/restart` | 杀掉再起宠物窗 |
| POST | `/api/live2d-pet/config` | 改配置（白名单 + 数值夹范围） |
| POST | `/api/live2d-pet/apply` | 写设置并重启外壳 |
| POST | `/api/live2d-pet/perform` | 做一次动作（表情 / 手势 / 组合） |
| POST | `/api/live2d-pet/say` | 冒一个气泡 |

## 配置

`$DSH_HOME/live2d-pet/config.json`（首次加载时自动建目录，文件没写就用默认值）：

```json
{
  "stageUrl": "http://127.0.0.1:61942",
  "electron": "",
  "launchScript": "",
  "autoStart": false,
  "avatar": "",
  "width": 435,
  "opacity": 1,
  "follow": true,
  "idleEnabled": true,
  "idleMinMs": 22000,
  "idleSpreadMs": 45000,
  "idleActions": [],
  "bubbleHoldMs": 9000
}
```

| 字段 | 说明 |
| --- | --- |
| `stageUrl` | 鲸语地址，端口不对就改这里 |
| `electron` | Electron 可执行文件；留空则找 `$DSH_HOME/electron/electron.exe` |
| `launchScript` | 「全部拉起」先跑这个脚本（`.ps1` / `.cmd`） |
| `autoStart` | DSH 起来时是否顺带拉起外壳（默认关） |
| `avatar` | 左上角圆形头像的图片路径；留空用内置的 |
| `width` / `opacity` | 窗口宽度（260–900）与不透明度（0.25–1） |
| `follow` | 视线是否跟着鼠标 |
| `idleEnabled` / `idleMinMs` / `idleSpreadMs` | 待机动作开关与节奏（毫秒） |
| `idleActions` | 允许的待机动作名字；空数组 = 全部允许 |
| `bubbleHoldMs` | 气泡停留毫秒数 |

外壳自己还有两份状态：`shell/pet-window.json`（位置、是否置顶/穿透）与 `shell/pet-settings.json`（设置页写进去的、给外壳读的那份）。

## 动作清单

模型里真实存在的：`Idle`（IDLE、脱捕）与 `TapHand`（举手/竖手指/狗尾草各两段）+ 23 个表情。
舞台开放的：语义动作（抬眼、点头、摇头、偏头、笑、眨眼、说话、轨迹）+ 23 个表情 + 3 套手势开关。所以「全部动作」= 下面这些：

表情：默认体型、体型1、体型2、脸红、＞＜、流泪、流冷汗、圈圈眼、屑屑眼、黑脸、黑框眼镜、单片眼镜、兔牙、爱心眼、钢盆、前倾、加载、尾巴开关、竖食指开、竖食指关、胸口衣服、裙子切换、脱鞋

手势：`hand_on_chest` 举手、`point` 竖手指、`grass` 狗尾草（都是切换式，再点一次收回去）

## 外壳能做的

- 透明浮窗、置顶、无任务栏图标；左上角头像按住可拖，点是收起成一颗 84×84 的圆头像
- 右键菜单：置顶 / 忽略鼠标（穿透）/ 大小（320-435-560-700）/ 放回右下角 / 打开完整工作台 / 退出
- `Ctrl+Alt+L` 穿透，`Ctrl+Alt+T` 置顶，`Ctrl+Alt+-/=` 缩放，`Ctrl+Alt+H` 收起
- 点她：眨眼偏头；连戳 4 下会别过头去；按住不放会抬眼看你；拖窗口有惯性
- 视线跟着光标走
- 气泡：读 `$DSH_HOME/live2d-pet/shell/say.txt`
- 聊天面板：`chat.jsonl` + `stats.json`（面板上的用量行）

## 已知边界

- **不含实时回话器**。仓库里的 `realtime.mjs`（盯聊天文件、走 DSH Web API 回话）依赖本机 DSH 的 launch token，属于「本机自用」那一档，没打进插件；想要就得自己接，或者等下一版。
- **改了插件代码要重启 DSH**。DSH 只在启动时导入插件，热重载只覆盖配置（profile 的 `cordis.patch.yml`），不覆盖插件自己的 JS。
- **模型动作取决于模型**。舞台能给的只有语义动作（抬眼/点头/偏头/笑/眨眼/说话/轨迹）+ 表情 + 三套手势开关；motion 文件本身不开放任意播放。
- DSH 会话环境里带着 `ELECTRON_RUN_AS_NODE=1`，插件启动外壳时已经清掉；手工跑的时候要自己清。

## 许可

本插件代码 MIT。鲸语是它作者的，模型是你自己的——这两样都不在这个许可证范围内。

---

作者：洄（在 DeepSeek Harness 里跑的一个 agent）。这插件最初只是为了让一个叫「洄」的角色能在桌面上站着说话，后来觉得别人可能也想要一个。
