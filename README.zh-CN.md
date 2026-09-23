# dsh-settings-order

[![ci](https://github.com/jackovibe/dsh-settings-order/actions/workflows/ci.yml/badge.svg)](https://github.com/jackovibe/dsh-settings-order/actions/workflows/ci.yml)

**让 DeepSeek Harness Web 的「设置」左列可以自由排序。**
拖动某一行、按 `Alt+↑`/`Alt+↓`，或用页脚的 `↑`/`↓` 按钮移动当前页——顺序存在宿主，
重启后仍在，凡是能访问宿主设置的浏览器都跟着变。

```
设置
 ↑ ↓ 恢复默认
 归档会话        ← 从最底下拖上来的
 通用设置
 模型
 插件
 插件市场
 …
```

![设置左列与排序按钮](docs/settings-order.png)

## 为什么需要它

设置面板的左列由 `settings.section` 列表槽渲染，而 SlotCore 会把这些条目
**按 `priority` 再按各插件自己登记的 `order` 排序**。也就是说每一行的位置是各插件
在打包时定死的：设置外壳既没有拖拽、也没有排序开关或偏好项，用户空间里没有任何
官方途径能改。

本插件不碰槽注册表（不重复注册、不覆盖 `order`、不去改别的包的 `order` 字段），
只是把**已经渲染出来的行**重新排列，并记住结果。

## 能力

| | |
| --- | --- |
| **拖拽** | 抓住任意一行拖到目标位置（有插入指示线） |
| **键盘** | 聚焦某行后按 `Alt+↑` / `Alt+↓` |
| **页脚按钮** | `↑` / `↓` 把**当前正在看的那个设置页**上移/下移一位——手机上唯一的可行路径（手机浏览器没有鼠标拖拽也没有 Alt 键） |
| **恢复默认** | 顺序一旦与内置顺序不同，页脚出现「恢复默认」 |
| **宿主持久** | 列表存在 `~/.dsh/settings.yaml` 的 `settings-order.order`，所有能连到宿主设置的浏览器共用 |
| **浏览器本地兜底** | 连不上宿主设置的浏览器（部分远端场景）退化为自己的 `localStorage`，并在页脚注明 |
| **失效可见** | 未来 DSH 若改了标记结构，插件什么都不做，并在页脚显示「无法识别设置项」，不会静默失效 |
| **非破坏性** | 第三方页（`archived-sessions`、`market`、`cost-meter`…）与内置页一样可排；后来新增的页留在外壳给它的位置；已不存在的 id 自动忽略 |

其他一切都不动：不改会话/工作区顺序，不碰别的插件的 DOM，不注册槽，不产生模型可见输入，不发网络请求。

## 安装

要求：装了 DSH 并带 Web GUI（已在 **0.1.6-alpha.2** 验证，0.1.5-rc.x 也能跑），
有一个可安装的 profile（下面统一用 `web`）。安装时不需要任何构建——客户端 bundle
是随包发布的成品。

```powershell
# 从 GitHub 安装（跟随 main）
dsh plugin --profile web add github:jackovibe/dsh-settings-order

# 想钉住某个发布版
dsh plugin --profile web add github:jackovibe/dsh-settings-order#v0.2.0

# 或从本地目录 / 打包产物安装
npm pack
dsh plugin --profile web add .\dsh-settings-order-0.2.0.tgz
```

`dsh plugin add` 会同时登记依赖**并**把它追加进 `dsh.profile.bundles`，挂载就靠这个：
包里自带 bundle patch，所以**不要**再在 profile 的 `cordis.patch.yml` 里写第二条
`insert`（重复 loader id 会导致启动失败）。

然后**重启 `dsh web`**：宿主半在启动时注册设置命名空间，而 profile 的客户端 bundle
是启动时快照后下发的，只刷新页面不够。打开**设置**——左列底部会出现 `↑` / `↓` 与一行
提示，改过顺序后还会出现「恢复默认」。

### 更新

```powershell
dsh plugin --profile web up dsh-settings-order   # 重新解析依赖
```

如果新版本改了客户端半（`lib/client.js`）就需要重启 `dsh web`；只改文档的版本不用。

## 用法

1. 打开 **设置**。
2. 想怎么排就怎么排：拖动某一行，或点选某个设置页后按页脚的 `↑` / `↓`
   （也可以在聚焦行上按 `Alt+↑` / `Alt+↓`）。
3. 顺序立即保存；一旦与内置顺序不同，页脚出现「恢复默认」。用过一次后那行提示会自动收起。

## 存储

`~/.dsh/settings.yaml`：

```yaml
settings-order:
  order:
    - general
    - archived-sessions
    - plugins
```

浏览器本地兜底（`localStorage`）：`dsh.settings-order.nav`（有序 id 列表）、
`dsh.settings-order.hint-seen`（提示是否已收起）。

## 实现要点

* **按 CSS Module 后缀定位行**：`[class*="_navList"]`、`[class*="_navCell"]`、
  `[class*="_navLabel"]`。哈希前缀（`VOzbGW_…`）会随构建变化，后缀不会。
* **行身份 = React key**：外壳用 `settings.section` 条目 id 作为每行按钮的 key，
  所以 fiber 的 `key` 就是宿主里存的那个 id；fiber 读不到时退回用行的文字标签。
* **重排 = 移动既有节点**：在同一个父节点内按目标顺序 `appendChild`，不重建节点，
  React 仍持有所有权；`MutationObserver` 在外壳重渲染列表时重新套用已保存的顺序。
* **内置顺序**（供「恢复默认」）实时读 `ctx.slots.entries('settings.section')`，
  SlotCore 保证它按 `priority` 再按 `order` 排序。
* **乐观写入**：本地顺序先落地并保持到宿主回显，慢往返也不会闪回。

`npm test` 把上述每一项（选择器、行 key、槽排序）都对着**本机已安装的 DSH** 钉住：
将来升级若破坏这些前提，是测试失败，而不是用户的设置面板坏掉。

## 验证

```powershell
npm run check   # 下发的 bundle 与源码一致
npm test        # 静态不变量 + 已安装宿主的契约
npm run e2e:dom # 把浏览器半注入实时 GUI 做交互验证
npm run e2e     # 对已安装插件验证：宿主持久、恢复默认、拖拽、刷新重放
```

`e2e/preinstall-dom-check.mjs` 在插件**未安装**时就能跑：把构建好的浏览器半注入正在运行的
GUI，用两种 ctx 各跑一次 `apply()`——一次没有 settings scope（远端/浏览器本地路径），一次对着
打桩的宿主 scope——并断言行身份、`Alt+↓`、原生 HTML5 拖拽、持久化、页脚 `↑`/`↓` 与「恢复默认」，
以及整页刷新后会重放已存顺序。`e2e/settings-order-e2e.mjs` 针对**已安装**的插件运行，开跑前
先快照宿主里的顺序、跑完恢复原样。

两个脚本用的 GUI 地址来自 `DSH_E2E_URL`，否则取 `~/.dsh/dsh-web.log` 里最新的 token 地址；
settings/workspace 文档来自 `DSH_E2E_HOME`，否则用 `~/.dsh`。需要 `playwright-core` 和可达的
`dsh web`。

### 用隔离的 home 验证

建议另起一个**独占自己 home** 的临时实例：settings 文档由「拥有它」的那个实例持久化，
而共享同一个 `~/.dsh` 的**第二个**实例只在内存里接受改动、不会重写 `settings.yaml`（0.1.6 实测）。
隔离 home 同时也保证你的真实设置不被测试碰到。

```powershell
$home2 = Join-Path (Get-Location) '.scratch-home'   # 放在仓库里，已被 git 忽略
New-Item -ItemType Directory $home2 -Force | Out-Null
New-Item -ItemType Junction "$home2\profiles" "$env:USERPROFILE\.dsh\profiles"   # 复用已装好的 profile
$env:DSH_HOME = $home2
dsh web --no-open --port 3099          # 会打印它自己的 token 地址
# 另开一个 shell：
$env:DSH_E2E_URL = 'http://127.0.0.1:3099/?token=…'
$env:DSH_E2E_HOME = $home2
node e2e/settings-order-e2e.mjs 3099
```

全新的 home 会弹首次使用的浮层（内测声明、侧栏提示），脚本会自动关掉它们——只按
「保持现状」那一类按钮，绝不点会改布局的项。`shots/` 被 git 忽略（整窗截图带真实会话标题），
只有 `docs/settings-order.png` 这张只截对话框一侧的图会进仓库。

## 卸载

```powershell
dsh plugin --profile web remove dsh-settings-order
# 并从 dsh.profile.bundles 里删掉 "dsh-settings-order"，然后重启 dsh web
```

`scripts/rollback.ps1` 会一次做完这两步并借助守护脚本重启。

## 兼容性

已在 DSH **0.1.6-alpha.2** 上验证（同时兼容 0.1.5-rc.x：设置外壳的标记与槽契约相同）。
找不到 DSH 安装时 `npm test` 会跳过宿主机契约部分；把 `DSH_CORE_ROOT` 指向
`@deepseek-ai` scope 目录即可校验指定构建。

## 开发

```powershell
node scripts/build-client.mjs          # src/client-src.js → lib/client.js
node scripts/build-client.mjs --check  # bundle 过期则失败
node --test                            # 契约 + 不变量
```

目录：`lib/index.js`（宿主半：设置命名空间）、`src/client-src.js`（浏览器半，纯脚本）、
`lib/client.js`（下发的 bundle）、`cordis.patch.yml`（bundle patch）、
`e2e/`、`test/`、`scripts/`、`docs/`。

## 隐私

`shots/` 被刻意 git 忽略：那里是实时 GUI 的整窗截图，带真实会话标题。README 里这张是
只截设置对话框的裁剪图。

## 许可

MIT —— 见 [LICENSE](LICENSE) 与 [NOTICE.md](NOTICE.md)。
