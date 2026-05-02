import express from "express";
import OpenAI from "openai";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const app = express();
const port = Number(process.env.PORT || 3000);
const runtimeConfigPath = path.join(process.cwd(), "data", "runtime-config.json");
const providerError = validateProviderConfig();
const provider = providerError
  ? "invalid-config"
  : hasOpenClawConfig()
    ? "openclaw"
    : process.env.MINIMAX_API_KEY
    ? "minimax"
    : process.env.OPENAI_API_KEY
      ? "openai"
      : "local-fallback";
const model =
  provider === "openclaw"
    ? process.env.OPENCLAW_MODEL || process.env.MINIMAX_MODEL || "MiniMax-M2.7"
    : provider === "minimax"
    ? process.env.MINIMAX_MODEL || "MiniMax-M2.7"
    : process.env.OPENAI_MODEL || "gpt-5.2";
const client = provider === "openai" ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const agentTimeoutMs = Number(process.env.AGENT_TIMEOUT_MS || 45000);
const agentsAdminPassword = process.env.AGENTS_ADMIN_PASSWORD || "6666";
const authSecret = process.env.AGENTS_AUTH_SECRET || process.env.MINIMAX_API_KEY || process.env.OPENAI_API_KEY || "lanpo-local";
const taskRuns = [];
const taskState = new Map();
const defaultTaskDefinitions = {
  "daily-brief": {
    name: "每日晨会推送",
    schedule: process.env.DAILY_BRIEF_TIME || "09:00",
    description: "生成今日经营方案，并推送到微信/企微 Webhook。",
  },
  "member-wakeup": {
    name: "会员唤醒提醒",
    schedule: process.env.MEMBER_WAKEUP_TIME || "MON 10:00",
    description: "每周筛选沉睡会员动作，提醒店长做私域触达。",
  },
};

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

function validateKey(name, value) {
  if (!value) {
    return null;
  }

  if (value !== value.trim()) {
    return `${name} 前后有空格或换行`;
  }

  if (!/^[\x21-\x7E]+$/.test(value)) {
    return `${name} 包含非英文字符，请确认不是中文占位符`;
  }

  return null;
}

function validateProviderConfig() {
  return (
    validateKey("MINIMAX_API_KEY", process.env.MINIMAX_API_KEY) ||
    validateKey("OPENAI_API_KEY", process.env.OPENAI_API_KEY)
  );
}

function loadRuntimeConfig() {
  try {
    return JSON.parse(fs.readFileSync(runtimeConfigPath, "utf8"));
  } catch {
    return { tasks: {} };
  }
}

function saveRuntimeConfig(config) {
  fs.mkdirSync(path.dirname(runtimeConfigPath), { recursive: true });
  fs.writeFileSync(runtimeConfigPath, `${JSON.stringify(config, null, 2)}\n`);
}

function getScheduledTasks() {
  const config = loadRuntimeConfig();
  return Object.entries(defaultTaskDefinitions).map(([id, definition]) => ({
    id,
    ...definition,
    ...(config.tasks?.[id] || {}),
  }));
}

function updateTaskSchedule(taskId, schedule) {
  if (!defaultTaskDefinitions[taskId]) {
    throw new Error(`Unknown task: ${taskId}`);
  }

  if (!/^(\d{2}:\d{2}|[A-Z]{3} \d{2}:\d{2})$/.test(schedule)) {
    throw new Error("计划格式应为 09:00 或 MON 10:00");
  }

  const config = loadRuntimeConfig();
  config.tasks = config.tasks || {};
  config.tasks[taskId] = {
    ...(config.tasks[taskId] || {}),
    schedule,
  };
  saveRuntimeConfig(config);
  return getScheduledTasks().find((task) => task.id === taskId);
}

const agentFiles = {
  data: "data.md",
  product: "product.md",
  media: "media.md",
  growth: "growth.md",
  manager: "manager.md",
};
const agentWorkflow = [
  { step: 1, id: "data", name: "数据 Agent", dependsOn: [] },
  { step: 2, id: "product", name: "产品 Agent", dependsOn: ["data"] },
  { step: 3, id: "media", name: "自媒体 Agent", dependsOn: ["data", "product"], parallelGroup: "market-and-service" },
  { step: 3, id: "growth", name: "客服私域 Agent", dependsOn: ["data", "product", "media"], parallelGroup: "market-and-service" },
  { step: 4, id: "manager", name: "店长总控 Agent", dependsOn: ["data", "product", "media", "growth"] },
];

function hasOpenClawConfig() {
  return Boolean(
    process.env.OPENCLAW_BASE_URL ||
      process.env.OPENCLAW_DATA_URL ||
      process.env.OPENCLAW_PRODUCT_URL ||
      process.env.OPENCLAW_MEDIA_URL ||
      process.env.OPENCLAW_GROWTH_URL ||
      process.env.OPENCLAW_MANAGER_URL,
  );
}

function loadAgentInstructions() {
  const agentsDir = path.join(process.cwd(), "agents");
  const loaded = {};

  for (const [name, file] of Object.entries(agentFiles)) {
    const filePath = path.join(agentsDir, file);
    loaded[name] = fs.readFileSync(filePath, "utf8").trim();
  }

  return loaded;
}

const agentInstructions = loadAgentInstructions();

function field(value, fallback = "") {
  return value === undefined || value === null || value === "" ? fallback : value;
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeMetrics(body) {
  return {
    date: field(body.date, new Date().toLocaleDateString("zh-CN")),
    weather: field(body.weather, "晴天"),
    revenue: safeNumber(body.revenue),
    cups: safeNumber(body.cups),
    ticket: safeNumber(body.ticket),
    views: safeNumber(body.views),
    engagement: safeNumber(body.engagement),
    mainProducts: field(body.mainProducts, "美式、拿铁、澳白"),
    note: field(body.note, ""),
  };
}

function extractJson(text) {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("Agent did not return JSON.");
    }
    return JSON.parse(match[0]);
  }
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) {
          return [part, ""];
        }

        return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function agentsAuthToken() {
  return crypto.createHmac("sha256", authSecret).update(`agents:${agentsAdminPassword}`).digest("hex");
}

function isAgentsAdmin(req) {
  return parseCookies(req.headers.cookie).lanpo_agents_auth === agentsAuthToken();
}

function renderAgentsLogin(error = "") {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>多 Agent 后端登录</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body class="admin-page">
    <main class="admin-login">
      <section class="module admin-card">
        <p class="eyebrow">蓝珀咖啡</p>
        <h1>多 Agent 后端管理</h1>
        <form method="post" action="/agents/login" class="admin-form">
          <label>
            <span>管理密码</span>
            <input name="password" type="password" inputmode="numeric" autocomplete="current-password" autofocus />
          </label>
          ${error ? `<p class="admin-error">${escapeHTML(error)}</p>` : ""}
          <button class="primary-action" type="submit">进入面板</button>
        </form>
      </section>
    </main>
  </body>
</html>`;
}

function renderAgentsPanel() {
  const workflow = agentWorkflow
    .map((agent) => {
      const dependsOn = agent.dependsOn.length ? agent.dependsOn.join("、") : "起点";
      return `<article>
        <span>${String(agent.step).padStart(2, "0")}</span>
        <h3>${escapeHTML(agent.name)}</h3>
        <p>依赖：${escapeHTML(dependsOn)}</p>
      </article>`;
    })
    .join("");

  const agentCards = Object.entries(agentInstructions)
    .map(([name, instruction]) => `<article class="module admin-agent">
      <div class="module-head">
        <div>
          <p class="eyebrow">${escapeHTML(name)}</p>
          <h2>${escapeHTML(agentFiles[name])}</h2>
        </div>
      </div>
      <pre class="report">${escapeHTML(instruction)}</pre>
    </article>`)
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>多 Agent 后端管理</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main class="workspace admin-workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow">后端管理</p>
          <h1>蓝珀咖啡多 Agent 后端</h1>
        </div>
        <a class="ghost-action admin-link-button" href="/agents/logout">退出</a>
      </header>

      <section class="module">
        <div class="module-head">
          <div>
            <p class="eyebrow">后端运行状态</p>
            <h2>${escapeHTML(provider === "openclaw" || provider === "minimax" || provider === "openai" ? `${provider}-agents` : "local-fallback")}</h2>
          </div>
          <span class="status">${escapeHTML(model || "本地兜底")}</span>
        </div>
        <div class="output">
          <p><strong>Provider：</strong>${escapeHTML(provider)}</p>
          <p><strong>OpenClaw：</strong>${hasOpenClawConfig() ? "已配置" : "未配置"}</p>
          <p><strong>MiniMax：</strong>${process.env.MINIMAX_API_KEY ? "已配置" : "未配置"}</p>
          <p><strong>OpenAI：</strong>${process.env.OPENAI_API_KEY ? "已配置" : "未配置"}</p>
          ${providerError ? `<p><strong>配置提示：</strong>${escapeHTML(providerError)}</p>` : ""}
        </div>
      </section>

      <section class="agents">
        <div class="section-title">
          <div>
            <p class="eyebrow">协作链路</p>
            <h2>数据 → 产品 → 自媒体 / 客服私域 → 店长总控</h2>
          </div>
        </div>
        <div class="agent-grid">${workflow}</div>
      </section>

      <section class="admin-agent-list">${agentCards}</section>
    </main>
  </body>
</html>`;
}

function minimaxEndpoint() {
  if (process.env.MINIMAX_ENDPOINT) {
    return process.env.MINIMAX_ENDPOINT;
  }

  const baseURL = (process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1").replace(/\/$/, "");
  return process.env.MINIMAX_API_MODE === "openai"
    ? `${baseURL}/chat/completions`
    : `${baseURL}/text/chatcompletion_v2`;
}

async function postJsonWithTimeout(url, body, headers, method = "POST") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), agentTimeoutMs);
  const request = {
    method,
    headers,
    signal: controller.signal,
  };
  if (body !== null && body !== undefined) {
    request.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, request);
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`MiniMax HTTP ${response.status}: ${text.slice(0, 500)}`);
    }

    return JSON.parse(text);
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`MiniMax request timed out after ${agentTimeoutMs}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function callMiniMax(messages) {
  const endpoint = minimaxEndpoint();
  const isOpenAICompatible = endpoint.endsWith("/chat/completions");
  const body = {
    model,
    messages: isOpenAICompatible
      ? messages
      : messages.map((message) => ({ ...message, name: message.role === "system" ? "MiniMax AI" : "User" })),
    temperature: 0.7,
    max_tokens: 2048,
  };

  const response = await postJsonWithTimeout(endpoint, body, {
    Authorization: `Bearer ${process.env.MINIMAX_API_KEY}`,
    "Content-Type": "application/json",
  });

  return extractJson(response.choices?.[0]?.message?.content || "");
}

function openClawEndpoint(name) {
  const key = `OPENCLAW_${name.toUpperCase()}_URL`;
  const baseURL = process.env[key] || process.env.OPENCLAW_BASE_URL || "http://127.0.0.1:18789";
  const trimmed = baseURL.replace(/\/$/, "");

  if (trimmed.endsWith("/v1/responses")) {
    return trimmed;
  }

  return `${trimmed}/v1/responses`;
}

function extractOpenClawText(response) {
  if (response.output_text) {
    return response.output_text;
  }

  const outputText = response.output
    ?.flatMap((item) => item.content || [])
    .map((content) => content.text || "")
    .join("")
    .trim();
  if (outputText) {
    return outputText;
  }

  const chatText = response.choices?.[0]?.message?.content;
  if (chatText) {
    return chatText;
  }

  throw new Error("OpenClaw did not return text.");
}

async function callOpenClaw(name, messages) {
  const headers = { "Content-Type": "application/json" };
  if (process.env.OPENCLAW_API_KEY) {
    headers.Authorization = `Bearer ${process.env.OPENCLAW_API_KEY}`;
  }

  const response = await postJsonWithTimeout(
    openClawEndpoint(name),
    {
      model,
      input: messages,
      metadata: {
        lanpoAgent: name,
        workflow: "lanpo-coffee-ops",
      },
    },
    headers,
  );

  return extractJson(extractOpenClawText(response));
}

async function runAgent(name, payload, schemaHint) {
  if (provider === "local-fallback" || provider === "invalid-config") {
    throw new Error("OPENCLAW_BASE_URL, MINIMAX_API_KEY or OPENAI_API_KEY is not configured correctly.");
  }

  const systemPrompt = `${agentInstructions[name]}

只输出 JSON，不要 Markdown，不要代码块。
JSON 结构要求：
${schemaHint}`;

  if (provider === "openclaw") {
    return callOpenClaw(name, [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: JSON.stringify(payload, null, 2),
      },
    ]);
  }

  if (provider === "openai") {
    const response = await client.responses.create({
      model,
      input: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: JSON.stringify(payload, null, 2),
        },
      ],
    });

    return extractJson(response.output_text || "");
  }

  return callMiniMax([
    {
      role: "system",
      content: systemPrompt,
    },
    {
      role: "user",
      content: JSON.stringify(payload, null, 2),
    },
  ]);
}

function localFallback(metrics, question = "减脂期能喝拿铁吗？") {
  const lowRevenue = metrics.revenue < 1800;
  const lowTicket = metrics.ticket < 24;
  const highEngagement = metrics.views > 0 && metrics.engagement / metrics.views > 0.06;
  const issue = lowRevenue
    ? "客单价尚可但营业额偏低，优先补进店流量和下午低峰杯量。"
    : lowTicket
      ? "杯量有基础但客单价偏低，需要通过套餐和加购提升单笔金额。"
      : highEngagement
        ? "内容互动不错，但到店引导还要更明确。"
        : "经营整体平稳，今天适合做场景主推和会员复购。";

  const product =
    metrics.weather === "晴天" || metrics.weather === "高温"
      ? "冰美式 + 低糖燕麦拿铁"
      : "热澳白 + 热拿铁";

  return {
    mode: "local-fallback",
    dataAgent: {
      issue,
      signals: ["营业额", "杯量", "客单价", "内容互动"],
      risks: ["低峰时段销售不足"],
      actions: ["上午发布咖啡知识内容", "下午执行第二杯半价", "评论区加入门店位置引导"],
    },
    productAgent: {
      heroProduct: product,
      audience: ["上班族", "减脂期女生", "熬夜后需要清醒的人"],
      avoid: ["高糖厚乳系列不作为减脂话题主推"],
      staffScript: `今天主推${product}，口感清爽，适合下午提神。`,
    },
    contentAgent: {
      topic: "熬夜后第二天咖啡怎么喝？",
      title: "熬夜党别乱喝咖啡，越喝越困可能是这个原因",
      cover: "熬夜后咖啡这样喝",
      videoStructure: ["开头钩子", "误区解释", "正确喝法", "到店引导"],
      body: "起床后 60-90 分钟再喝，中杯就够，不建议太晚。滨江附近上班的朋友，可以来蓝珀试试低糖燕麦拿铁。",
      commentGuide: "你一般几点喝第一杯咖啡？",
    },
    serviceAgent: {
      question,
      reply: "可以喝，但建议选中杯、少糖或不加糖。如果今天热量控制比较严格，可以选冰美式；想顺滑一点就选低糖拿铁。太晚不建议喝大杯。",
    },
    managerAgent: {
      summary: issue,
      priority: ["先补下午低峰流量", "主推低糖清爽产品", "内容结尾加入到店福利"],
      report: buildReportText(metrics, issue, product),
    },
  };
}

function buildReportText(metrics, issue, product, contentTopic = "熬夜后第二天咖啡怎么喝？") {
  return `蓝珀咖啡每日运营日报

日期：${metrics.date}
天气：${metrics.weather}
昨日营业额：¥${Math.round(metrics.revenue).toLocaleString("zh-CN")}
昨日杯量：${metrics.cups} 杯
客单价：¥${Math.round(metrics.ticket).toLocaleString("zh-CN")}
主销产品：${metrics.mainProducts}

问题判断：
${issue}

今日主推：
${product}

今日内容选题：
《${contentTopic}》

今日活动：
蓝珀下午续命计划，14:00-17:00 任意咖啡第二杯半价。

员工重点动作：
1. 门口立牌改为“熬夜后喝什么咖啡”
2. 收银优先推荐今日主推产品
3. 记录顾客对低糖、燕麦奶、冰饮的反馈
4. 下午低峰时段提醒老客到店或外卖下单

老板提醒：
今天重点看进店流量、低峰杯量和内容到店转化。`;
}

function defaultMetrics(overrides = {}) {
  return normalizeMetrics({
    date: new Date().toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }),
    weather: "晴天",
    revenue: 2680,
    cups: 96,
    ticket: 28,
    views: 1240,
    engagement: 68,
    ...overrides,
  });
}

async function getFeishuTenantToken() {
  if (!process.env.FEISHU_APP_ID || !process.env.FEISHU_APP_SECRET) {
    throw new Error("FEISHU_APP_ID or FEISHU_APP_SECRET is not configured.");
  }

  const response = await postJsonWithTimeout(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      app_id: process.env.FEISHU_APP_ID,
      app_secret: process.env.FEISHU_APP_SECRET,
    },
    { "Content-Type": "application/json" },
  );

  if (!response.tenant_access_token) {
    throw new Error(response.msg || "Feishu tenant token missing.");
  }

  return response.tenant_access_token;
}

async function fetchFeishuRecords(tableId, pageSize = 20) {
  if (!process.env.FEISHU_BITABLE_APP_TOKEN || !tableId) {
    return [];
  }

  const token = await getFeishuTenantToken();
  const url = new URL(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${process.env.FEISHU_BITABLE_APP_TOKEN}/tables/${tableId}/records`,
  );
  url.searchParams.set("page_size", String(pageSize));

  const response = await postJsonWithTimeout(
    url.toString(),
    null,
    {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    "GET",
  );

  return response.data?.items || [];
}

function getRecordField(record, names, fallback = "") {
  const fields = record.fields || {};
  for (const name of names) {
    if (fields[name] !== undefined && fields[name] !== null && fields[name] !== "") {
      return fields[name];
    }
  }
  return fallback;
}

function normalizeFeishuText(value) {
  if (Array.isArray(value)) {
    return value.map((item) => item.text || item.name || String(item)).join("、");
  }
  return String(value ?? "");
}

function latestRecord(records, dateFieldNames) {
  return [...records].sort((a, b) => {
    const left = String(getRecordField(a, dateFieldNames, ""));
    const right = String(getRecordField(b, dateFieldNames, ""));
    return right.localeCompare(left);
  })[0];
}

async function fetchFeishuMetrics() {
  const dailyRecords = await fetchFeishuRecords(process.env.FEISHU_DAILY_TABLE_ID);
  const contentRecords = await fetchFeishuRecords(process.env.FEISHU_CONTENT_TABLE_ID);
  const daily = latestRecord(dailyRecords, ["日期", "date"]);
  const content = latestRecord(contentRecords, ["发布时间", "日期", "date"]);

  if (!daily && !content) {
    throw new Error("没有读取到飞书记录，请检查 app_token、table_id 和应用权限。");
  }

  return normalizeMetrics({
    date: normalizeFeishuText(getRecordField(daily || {}, ["日期", "date"], new Date().toLocaleDateString("zh-CN"))),
    weather: normalizeFeishuText(getRecordField(daily || {}, ["天气", "weather"], "晴天")),
    revenue: getRecordField(daily || {}, ["堂食营业额", "营业额", "revenue"], 0),
    cups: getRecordField(daily || {}, ["堂食杯量", "杯量", "cups"], 0),
    ticket: getRecordField(daily || {}, ["堂食客单价", "客单价", "ticket"], 0),
    views: getRecordField(content || {}, ["72h曝光", "24h曝光", "浏览", "views"], 0),
    engagement:
      safeNumber(getRecordField(content || {}, ["点赞", "likes"], 0)) +
      safeNumber(getRecordField(content || {}, ["收藏", "收藏评论", "engagement"], 0)) +
      safeNumber(getRecordField(content || {}, ["评论数", "comments"], 0)),
    mainProducts: normalizeFeishuText(getRecordField(daily || {}, ["主销TOP3", "主销产品", "mainProducts"], "美式、拿铁、澳白")),
  });
}

async function runDailyWorkflow(metrics, question = "减脂期能喝拿铁吗？") {
  if (provider === "local-fallback" || provider === "invalid-config") {
    return localFallback(metrics, question);
  }

  const dataAgent = await runAgent(
    "data",
    { metrics },
    `{ "issue": "一句核心问题", "signals": ["关键数据"], "risks": ["风险"], "actions": ["明日动作"] }`,
  );

  const productAgent = await runAgent(
    "product",
    { metrics, dataAgent },
    `{ "heroProduct": "主推产品组合", "audience": ["适合人群"], "avoid": ["避开项"], "staffScript": "员工推荐话术" }`,
  );

  const mediaAgent = await runAgent(
    "media",
    { metrics, dataAgent, productAgent },
    `{ "topic": "选题", "title": "标题", "cover": "封面文案", "videoStructure": ["结构"], "body": "小红书正文", "commentGuide": "评论区引导", "conversionLine": "门店转化句" }`,
  );

  const growthAgent = await runAgent(
    "growth",
    { question, metrics, dataAgent, productAgent, mediaAgent },
    `{ "question": "顾客问题", "reply": "可直接发送的回复", "privateActions": ["私域动作"], "commentReplies": ["评论区回复"] }`,
  );
  const contentAgent = mediaAgent;
  const serviceAgent = growthAgent.serviceAgent || growthAgent;

  const managerAgent = await runAgent(
    "manager",
    { metrics, dataAgent, productAgent, mediaAgent, growthAgent },
    `{ "summary": "今日总判断", "priority": ["优先动作"], "report": "完整日报文本" }`,
  );

  return {
    mode: `${provider}-agents`,
    dataAgent,
    productAgent,
    mediaAgent,
    growthAgent,
    contentAgent,
    serviceAgent,
    managerAgent,
  };
}

async function runCustomerWorkflow(metrics, question) {
  if (provider === "local-fallback" || provider === "invalid-config") {
    return localFallback(metrics, question).serviceAgent;
  }

  const productAgent = await runAgent(
    "product",
    { metrics },
    `{ "heroProduct": "主推产品组合", "audience": ["适合人群"], "avoid": ["避开项"], "staffScript": "员工推荐话术" }`,
  );
  const mediaAgent = await runAgent(
    "media",
    { metrics, productAgent },
    `{ "topic": "可选内容选题", "title": "可选标题", "cover": "可选封面文案", "videoStructure": ["可选结构"], "body": "可选正文", "commentGuide": "可选评论引导", "conversionLine": "可选门店转化句" }`,
  );
  const growthAgent = await runAgent(
    "growth",
    { question, metrics, productAgent, mediaAgent },
    `{ "question": "顾客问题", "reply": "可直接发送的回复", "privateActions": ["私域动作"], "commentReplies": ["评论区回复"] }`,
  );

  return growthAgent.serviceAgent || growthAgent;
}

async function sendWechatText(content) {
  if (!process.env.WECHAT_OUTBOUND_WEBHOOK) {
    return { ok: false, skipped: true, reason: "WECHAT_OUTBOUND_WEBHOOK is not configured." };
  }

  const response = await postJsonWithTimeout(
    process.env.WECHAT_OUTBOUND_WEBHOOK,
    {
      msgtype: "text",
      text: {
        content,
      },
    },
    { "Content-Type": "application/json" },
  );

  return { ok: true, response };
}

function recordTaskRun(taskId, status, detail) {
  const item = {
    taskId,
    status,
    detail,
    at: new Date().toISOString(),
  };
  taskRuns.unshift(item);
  taskRuns.splice(30);
  return item;
}

async function runScheduledTask(taskId, source = "manual") {
  if (taskId === "daily-brief") {
    const workflow = await runDailyWorkflow(defaultMetrics(), "今天适合推什么给老客？");
    const report = workflow.managerAgent?.report || workflow.managerAgent?.summary || "今日方案已生成。";
    const push = await sendWechatText(report);
    return recordTaskRun(taskId, "success", { source, pushed: push.ok, skipped: push.skipped, report });
  }

  if (taskId === "member-wakeup") {
    const message = "会员唤醒提醒：筛选沉睡 30 天以上、累计消费 200 元以上的老客，今天优先推送低糖拿铁/冰美式第二杯优惠。";
    const push = await sendWechatText(message);
    return recordTaskRun(taskId, "success", { source, pushed: push.ok, skipped: push.skipped, message });
  }

  throw new Error(`Unknown task: ${taskId}`);
}

function shanghaiNowParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function shouldRunTask(task, parts) {
  const minuteKey = `${parts.weekday}-${parts.hour}:${parts.minute}`;
  if (taskState.get(task.id) === minuteKey) {
    return false;
  }

  if (/^[A-Z]{3} \d{2}:\d{2}$/.test(task.schedule)) {
    const [weekday, time] = task.schedule.split(" ");
    return parts.weekday.toUpperCase() === weekday && `${parts.hour}:${parts.minute}` === time;
  }

  return `${parts.hour}:${parts.minute}` === task.schedule;
}

function startScheduler() {
  setInterval(() => {
    const parts = shanghaiNowParts();
    for (const task of getScheduledTasks()) {
      if (!shouldRunTask(task, parts)) {
        continue;
      }

      taskState.set(task.id, `${parts.weekday}-${parts.hour}:${parts.minute}`);
      runScheduledTask(task.id, "schedule").catch((error) => {
        recordTaskRun(task.id, "failed", { source: "schedule", error: error.message });
      });
    }
  }, 60 * 1000);
}

app.get("/agents", (req, res) => {
  if (!isAgentsAdmin(req)) {
    res.status(401).send(renderAgentsLogin());
    return;
  }

  res.send(renderAgentsPanel());
});

app.get("/agents/", (req, res) => {
  res.redirect("/agents");
});

app.post("/agents/login", (req, res) => {
  if (String(req.body?.password || "") !== agentsAdminPassword) {
    res.status(401).send(renderAgentsLogin("密码不正确"));
    return;
  }

  res.cookie("lanpo_agents_auth", agentsAuthToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 12,
  });
  res.redirect("/agents");
});

app.get("/agents/logout", (_req, res) => {
  res.clearCookie("lanpo_agents_auth");
  res.redirect("/agents");
});

app.use(express.static(process.cwd(), { extensions: ["html"] }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: !providerError,
    mode: provider === "openclaw" || provider === "minimax" || provider === "openai" ? `${provider}-agents` : "local-fallback",
    model: provider === "openclaw" || provider === "minimax" || provider === "openai" ? model : null,
    provider,
    agents: Object.keys(agentInstructions),
    workflow: agentWorkflow,
    configured: {
      openclaw: hasOpenClawConfig(),
      minimax: Boolean(process.env.MINIMAX_API_KEY),
      openai: Boolean(process.env.OPENAI_API_KEY),
    },
    error: providerError,
  });
});

app.get("/api/agents", (req, res) => {
  if (!isAgentsAdmin(req)) {
    res.status(401).json({ error: "agents_admin_login_required" });
    return;
  }

  res.json({
    workflow: agentWorkflow,
    agents: Object.entries(agentInstructions).map(([name, instruction]) => ({
      name,
      file: agentFiles[name],
      preview: instruction.slice(0, 260),
    })),
  });
});

app.get("/api/agent-check", async (_req, res) => {
  if (providerError) {
    res.status(400).json({ ok: false, provider, error: providerError });
    return;
  }

  if (provider === "local-fallback") {
    res.status(400).json({
      ok: false,
      provider: "local-fallback",
      error: "没有配置 OPENCLAW_BASE_URL、MINIMAX_API_KEY 或 OPENAI_API_KEY",
    });
    return;
  }

  try {
    const result = await runCustomerWorkflow(
      normalizeMetrics({ weather: "晴天", revenue: 2680, cups: 96, ticket: 28 }),
      "减脂期能喝拿铁吗？",
    );

    res.json({ ok: true, provider, model, result });
  } catch (error) {
    res.status(500).json({ ok: false, provider, model, error: error.message });
  }
});

app.post("/api/workflows/daily", async (req, res) => {
  const metrics = normalizeMetrics(req.body || {});
  const question = field(req.body?.question, "减脂期能喝拿铁吗？");

  try {
    res.json(await runDailyWorkflow(metrics, question));
  } catch (error) {
    res.status(500).json({
      error: "agent_workflow_failed",
      message: error.message,
      fallback: localFallback(metrics, question),
    });
  }
});

app.post("/api/workflows/customer", async (req, res) => {
  const metrics = normalizeMetrics(req.body || {});
  const question = field(req.body?.question, "减脂期能喝拿铁吗？");

  try {
    res.json(await runCustomerWorkflow(metrics, question));
  } catch (error) {
    res.status(500).json({
      error: "customer_workflow_failed",
      message: error.message,
      fallback: localFallback(metrics, question).serviceAgent,
    });
  }
});

app.get("/api/tasks", (_req, res) => {
  res.json({
    tasks: getScheduledTasks(),
    runs: taskRuns,
    webhookConfigured: Boolean(process.env.WECHAT_OUTBOUND_WEBHOOK),
  });
});

app.patch("/api/tasks/:id", (req, res) => {
  try {
    res.json(updateTaskSchedule(req.params.id, String(req.body?.schedule || "")));
  } catch (error) {
    res.status(400).json({ error: "task_update_failed", message: error.message });
  }
});

app.post("/api/tasks/:id/run", async (req, res) => {
  try {
    res.json(await runScheduledTask(req.params.id, "manual"));
  } catch (error) {
    res.status(500).json({ error: "task_failed", message: error.message });
  }
});

app.get("/api/integrations/wechat", (_req, res) => {
  res.json({
    outboundWebhook: Boolean(process.env.WECHAT_OUTBOUND_WEBHOOK),
    verifyToken: Boolean(process.env.WECHAT_VERIFY_TOKEN),
    webhookUrl: "/api/wechat/webhook",
    bindingOptions: [
      "企微群机器人：最快可用，适合把日报和客服建议推到运营群。",
      "公众号/服务号：需要微信公众平台配置服务器 URL 和 Token。",
      "企微应用：适合一对一客户运营，需要企业微信应用凭证和客户联系权限。",
    ],
  });
});

app.get("/api/integrations/feishu", (_req, res) => {
  res.json({
    configured: Boolean(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET && process.env.FEISHU_BITABLE_APP_TOKEN),
    appToken: Boolean(process.env.FEISHU_BITABLE_APP_TOKEN),
    dailyTable: Boolean(process.env.FEISHU_DAILY_TABLE_ID),
    contentTable: Boolean(process.env.FEISHU_CONTENT_TABLE_ID),
  });
});

app.post("/api/data/feishu/sync", async (_req, res) => {
  try {
    res.json({ ok: true, metrics: await fetchFeishuMetrics() });
  } catch (error) {
    res.status(500).json({ error: "feishu_sync_failed", message: error.message });
  }
});

app.get("/api/wechat/webhook", (req, res) => {
  const token = process.env.WECHAT_VERIFY_TOKEN;
  if (!token || req.query.token !== token) {
    res.status(403).send("invalid token");
    return;
  }

  res.send(String(req.query.echostr || "ok"));
});

app.post("/api/wechat/webhook", async (req, res) => {
  const token = process.env.WECHAT_VERIFY_TOKEN;
  if (token && req.query.token !== token && req.headers["x-wechat-token"] !== token) {
    res.status(403).json({ error: "invalid_token" });
    return;
  }

  const text = field(req.body?.Content || req.body?.text || req.body?.message, "");
  if (!text) {
    res.status(400).json({ error: "missing_message" });
    return;
  }

  try {
    const reply = await runCustomerWorkflow(defaultMetrics(), text);
    const push = await sendWechatText(reply.reply || String(reply));
    res.json({ ok: true, reply, pushed: push.ok, skipped: push.skipped });
  } catch (error) {
    res.status(500).json({ error: "wechat_workflow_failed", message: error.message });
  }
});

app.post("/api/interactions/wechat", async (req, res) => {
  const metrics = normalizeMetrics(req.body || {});
  const question = field(req.body?.question || req.body?.message, "减脂期能喝拿铁吗？");

  try {
    const reply = await runCustomerWorkflow(metrics, question);
    const push = req.body?.push ? await sendWechatText(reply.reply || String(reply)) : { ok: false, skipped: true };
    res.json({ ok: true, reply, pushed: push.ok, skipped: push.skipped });
  } catch (error) {
    res.status(500).json({ error: "interaction_failed", message: error.message });
  }
});

app.listen(port, () => {
  startScheduler();
  console.log(`Lanpo coffee ops running on http://localhost:${port}`);
});
