# 校园余额 · GDBTU

广东工商职业技术大学的校园卡余额、宿舍电费，放进 iPhone 小组件和 Web Dashboard。

从个人 BeamJasonESP 项目的校园模块独立整理，不依赖 ESP32、个人 Mac companion 或云端中转。学校接口可能变化，这是非官方个人工具。

![Web Dashboard，演示数据](docs/images/dashboard-desktop.png)

## 能做什么

- **Scriptable 小组件**：Small / Medium，个人参数存入 Keychain。
- **Web 面板**：沿用原 Dashboard 的校园卡片、走势图和记录表，Python 标准库即可运行。
- **更少手填**：尝试从已登录的官方 H5 页面导出配置，导入小组件；无须逐层抄写楼栋、楼层、房间 ID。
- **独立查询**：一项失败不阻断另一项；失败保留上次有效余额并标记缓存，不将缺失数据显示成 0。
- **时间分开**：学校更新时间与本机查询时间分别保留。校园卡接口可能没有学校更新时间。

> 官方网页导出方式已核对当前公开前端代码，并通过模拟会话测试；尚未使用真实登录会话完成端到端验证。微信内网页不一定支持书签脚本，也不一定与 Safari 共享登录。不能保证所有用户免抓包。

## 先看界面

需要 Python 3.10 或以上，无需 pip 安装依赖：

```bash
git clone https://github.com/JasonBeam/gdbtu-campus-balance.git
cd gdbtu-campus-balance
python3 server.py --demo
```

打开 <http://127.0.0.1:4186>。演示模式不访问学校接口，Web 截图中的金额与走势均为演示数据。

![手机宽度的实际 Web 页面，演示数据](docs/images/dashboard-mobile.png)

## 接入自己的账户

1. 先阅读 [配置提取教程](docs/setup.md)，优先尝试官方页面导出方式。
2. 将个人配置保存为项目根目录下的 `config.local.json`。配置模板见 [config.example.json](config.example.json)。
3. macOS / Linux 可执行 `chmod 600 config.local.json`，然后启动：

```bash
python3 server.py
```

默认只监听 `127.0.0.1`，这是个人本机面板。手机截图代表响应式布局；不会自动把电脑面板开放给局域网或互联网。小组件直接查询学校，不依赖面板常驻。

## iPhone 小组件

沿用现用脚本的点阵数字与双区布局；电表有 `remaining` 时显示剩余电量，底部显示电费金额。

<img src="docs/images/scriptable-iphone-real.png" width="320" alt="现用脚本的 iPhone 实机预览，真实数值，经本人同意公开">

上图来自现用个人脚本的真实 iPhone 预览，数值经本人同意公开；不把旧脚本的查询成功当作新数据链路已通过。

<img src="docs/images/scriptable-iphone-demo.png" width="320" alt="独立脚本在真实 iPhone 上的 Small 演示渲染">

独立版已在真实 iPhone 上完成 Small 演示渲染，使用独立 Keychain 前缀，原个人脚本与配置保留。

1. 安装 [Scriptable](https://scriptable.app/)。
2. 新建脚本，复制 [scriptable/校园余额.js](scriptable/%E6%A0%A1%E5%9B%AD%E4%BD%99%E9%A2%9D.js) 全部内容并运行。
3. 选择“导入官方页面配置”，粘贴自己导出的 JSON；也可手动配置。
4. 选择“查询并预览”，核对两项余额。
5. 在 iPhone 桌面添加 Scriptable 小组件并选择此脚本，支持小号和中号。组件参数填 `demo` 可预览演示数据。

iOS 决定实际刷新时机，20 分钟是脚本缓存与建议刷新间隔，不保证准点更新。Keychain 使用独立前缀 `gdbtu_public_v1_`，不会覆盖旧的个人脚本配置。

## 参数与来源

| 参数 | 用途 | 必填 |
| --- | --- | --- |
| `syscustid` | 当前官方会话的用户标识 | 是 |
| `acc_token` | 官方登录凭据，可能过期 | 是 |
| `areacode` | 官方会话的学校区域代码 | 是，请以自己的会话为准 |
| `buildingID` | 官方电费页面最终选择的宿舍节点 | 电费需要 |
| `custid` | 校园卡账户标识，与 syscustid 不同 | 单账户时尝试自动获取 |
| `userAgent` | 官方页面的浏览器标识 | 可选 |
| `timestamp` | 官方会话中已有的时间字段 | 可选，导出工具自动保留 |

`buildingID` 不一定只代表“楼栋”。官方新电费页面沿层级加载，最终选择的叶节点也使用这个字段。不要根据名字猜 ID，不要用别人的参数。

接口适配来自现有 ESP32 与 Scriptable 实现，并对照当前官方公开前端做静态审查。仅保留余额查询和校园卡会话初始化，不提供充值、缴费、绑定宿舍或批量查询功能。

## 验证与限制

```bash
python3 -m unittest discover -s tests -v
node tests/test_scriptable.cjs
node tests/test_export.cjs
```

详见 [审查记录](docs/review.md)。本次交付验证代码、模拟接口、导出工具的模拟会话、实际 Web 页面和独立脚本在 iPhone 上的 Small 演示渲染；独立版真实学校账户查询、微信内导出、Medium 实机布局与后台刷新仍待验证。截图不作为真实余额查询成功的证据。

查询按 20 分钟缓存，网页每分钟只读取本机状态；只记录首次采集后的校园余额观察值，不推断消费账单；历史保存在被忽略的 `private/campus.sqlite3`。缺少学校更新时间时不补造历史。重启服务后当前值内存缓存清空，历史保留。

## 公开资料与隐私

`config.local.json`、抓包文件、日志和临时浏览器输出已被忽略。导出工具仅在学校官方域名运行，仅读取两项已知本地记录，不发网络请求，点击后才保存或复制配置。不要上传个人配置、剪贴板内容或原始抓包。Web 截图使用演示金额；手机实机截图会单独标明实际来源。

本项目与广东工商职业技术大学、云间校园、Scriptable 无官方关联。请遵守学校系统使用规则，仅使用自己的合法登录会话。

点阵与等宽字形使用 Doto / Space Mono 栅格素材，随附其 [SIL Open Font License](docs/licenses/)；面板布局和小组件绘制函数沿用个人 BeamJasonESP / Scriptable 项目。
