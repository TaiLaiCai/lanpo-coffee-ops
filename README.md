# 蓝珀咖啡运营中控 MVP

这是蓝珀咖啡多 Agent 运营系统的第一版可运行服务，前台和后端职责分开：

- `https://sandlabs.cn`：运营前台交互台，给店长和运营录入数据、生成方案、复制日报
- `https://sandlabs.cn/agents`：多 Agent 后端管理面板，查看运行状态、协作链路和 Agent 配置，密码保护
- `/api/workflows/*`：前台调用的 Agent 工作流接口
- `/api/agents`：后端管理接口，需要先登录 `/agents`

当前先跑通核心业务闭环：

- 店长总控 Agent：汇总经营判断与今日执行动作
- 内容运营 Agent：生成选题、标题、视频结构和发布提醒
- 咖啡产品 Agent：推荐主推产品、适合人群和避开项
- 私域客服 Agent：生成顾客咨询回复
- 数据复盘 Agent：根据营业额、杯量、客单价、内容数据判断问题

## 本地运行

安装依赖：

```bash
npm install
```

配置 MiniMax API Key：

```bash
cp .env.example .env
# 然后把 .env 里的 MINIMAX_API_KEY 改成真实 Key
```

然后访问：

```bash
npm start
```

```text
http://localhost:3000
```

没有配置 `MINIMAX_API_KEY` 时，系统会自动使用本地规则兜底；配置后会启用真实多 Agent 工作流。

多 Agent 后端管理面板地址：

```text
https://sandlabs.cn/agents
```

默认密码是 `6666`。这个入口只用于后端管理，不是日常运营交互页。如果要修改密码，更新服务器 `/opt/lanpo-coffee-ops/.env`：

```bash
AGENTS_ADMIN_PASSWORD=新密码
sudo systemctl restart lanpo-coffee-ops
```

## 多 Agent 工作流

- `POST /api/workflows/daily`：每日晨会，依次调用数据、产品、内容、客服、总控 Agent
- `POST /api/workflows/customer`：顾客咨询，调用产品 Agent 和客服 Agent
- `GET /api/health`：查看当前运行模式

后端默认使用 MiniMax 的 OpenAI-compatible Chat Completions API，密钥只放在服务器环境变量里，不暴露到浏览器。

当前 Agent 编排顺序固定为：

```text
数据 Agent
  ↓
产品 Agent
  ↓
内容 Agent + 客服 Agent
  ↓
店长总控 Agent
```

其中内容 Agent 和客服 Agent 会在产品 Agent 输出后并行执行；店长总控 Agent 最后读取全部结果，输出今日判断、日报和执行清单。

## sandlabs.cn 部署

服务器上执行：

```bash
curl -fsSL https://raw.githubusercontent.com/TaiLaiCai/lanpo-coffee-ops/main/scripts/deploy-sandlabs.sh | sudo bash
```

脚本会安装依赖、提示输入 MiniMax API Key、启动 systemd 服务，并让 Nginx 反代到 Node Agent 服务。

脚本会先配置 HTTP，再尝试自动申请 HTTPS 证书并跳转到 HTTPS。网页打不开时优先确认：

- 域名拼写是 `sandlabs.cn`，不是 `sandlasbs.cn`
- 域名 A 记录指向服务器公网 IP
- 服务器安全组/防火墙开放 `80` 和 `443`
- Node 服务正在监听 `127.0.0.1:3000`

部署脚本也会在服务器安装 MiniMax 官方 `Mini-Agent` 运行工具：

- 安装 `uv`
- 安装或升级 `mini-agent`
- 写入 `/root/.mini-agent/config/config.yaml`
- 默认工作区指向 `/opt/lanpo-coffee-ops`

安装后可在服务器上验证：

```bash
mini-agent --version
mini-agent --workspace /opt/lanpo-coffee-ops
```

## 下一阶段可接入

- 飞书多维表格：读取每日营业额、杯量、客单价、内容数据
- OpenClaw Gateway：把页面里的规则替换为真实多 Agent 工作流
- 微信 / 企微：接入私域客服回复
- 小红书 / 抖音：生成内容后进入人工审核发布
- Vercel / 服务器：部署成可访问的运营后台

## 部署需要的信息

如果要部署到线上，请提供其中一种：

- Vercel 账号或项目授权
- 服务器 SSH 信息和域名
- 已有 OpenClaw 部署地址和接口说明
- 飞书应用凭证与多维表格结构

## Agent 文件化管理

5 个核心 Agent 已拆分到 `agents/` 目录：

- `agents/manager.md`：店长总控 Agent，负责最终取舍、日报和执行清单
- `agents/data.md`：数据复盘 Agent，负责经营判断和预警
- `agents/product.md`：咖啡产品 Agent，负责产品推荐、专业校验和员工话术
- `agents/content.md`：内容运营 Agent，负责小红书/抖音/朋友圈内容
- `agents/service.md`：私域客服 Agent，负责微信、社群和评论回复

后端启动时会读取这些 Markdown 文件。修改某个 Agent 的职责或个性后，重启服务即可生效：

```bash
sudo systemctl restart lanpo-coffee-ops
```

查看当前服务加载的 Agent 配置：浏览器打开 `https://sandlabs.cn/agents`，输入管理密码后查看。`/api/agents` 只给已登录管理面板使用，不作为公开接口。

查看服务当前运行模式和 Agent 链路：

```bash
curl -s http://127.0.0.1:3000/api/health
```
