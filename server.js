import express from "express";
import OpenAI from "openai";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const app = express();
const port = Number(process.env.PORT || 3000);
const providerError = validateProviderConfig();
const provider = providerError
  ? "invalid-config"
  : process.env.MINIMAX_API_KEY
    ? "minimax"
    : process.env.OPENAI_API_KEY
      ? "openai"
      : "local-fallback";
const model =
  provider === "minimax"
    ? process.env.MINIMAX_MODEL || "MiniMax-M2.7"
    : process.env.OPENAI_MODEL || "gpt-5.2";
const client = provider === "openai" ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const agentTimeoutMs = Number(process.env.AGENT_TIMEOUT_MS || 45000);
const agentsAdminPassword = process.env.AGENTS_ADMIN_PASSWORD || "6666";
const authSecret = process.env.AGENTS_AUTH_SECRET || process.env.MINIMAX_API_KEY || process.env.OPENAI_API_KEY || "lanpo-local";

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

const agentFiles = {
  data: "data.md",
  product: "product.md",
  content: "content.md",
  service: "service.md",
  manager: "manager.md",
};
const agentWorkflow = [
  { step: 1, id: "data", name: "数据 Agent", dependsOn: [] },
  { step: 2, id: "product", name: "产品 Agent", dependsOn: ["data"] },
  { step: 3, id: "content", name: "内容 Agent", dependsOn: ["data", "product"], parallelGroup: "growth-and-service" },
  { step: 3, id: "service", name: "客服 Agent", dependsOn: ["product"], parallelGroup: "growth-and-service" },
  { step: 4, id: "manager", name: "店长总控 Agent", dependsOn: ["data", "product", "content", "service"] },
];

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
            <h2>${escapeHTML(provider === "minimax" || provider === "openai" ? `${provider}-agents` : "local-fallback")}</h2>
          </div>
          <span class="status">${escapeHTML(model || "本地兜底")}</span>
        </div>
        <div class="output">
          <p><strong>Provider：</strong>${escapeHTML(provider)}</p>
          <p><strong>MiniMax：</strong>${process.env.MINIMAX_API_KEY ? "已配置" : "未配置"}</p>
          <p><strong>OpenAI：</strong>${process.env.OPENAI_API_KEY ? "已配置" : "未配置"}</p>
          ${providerError ? `<p><strong>配置提示：</strong>${escapeHTML(providerError)}</p>` : ""}
        </div>
      </section>

      <section class="agents">
        <div class="section-title">
          <div>
            <p class="eyebrow">协作链路</p>
            <h2>数据 → 产品 → 内容 / 客服 → 店长总控</h2>
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

async function postJsonWithTimeout(url, body, headers) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), agentTimeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
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

async function runAgent(name, payload, schemaHint) {
  if (provider === "local-fallback" || provider === "invalid-config") {
    throw new Error("MINIMAX_API_KEY or OPENAI_API_KEY is not configured correctly.");
  }

  const systemPrompt = `${agentInstructions[name]}

只输出 JSON，不要 Markdown，不要代码块。
JSON 结构要求：
${schemaHint}`;

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
    mode: provider === "minimax" || provider === "openai" ? `${provider}-agents` : "local-fallback",
    model: provider === "minimax" || provider === "openai" ? model : null,
    provider,
    agents: Object.keys(agentInstructions),
    workflow: agentWorkflow,
    configured: {
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
      error: "没有配置 MINIMAX_API_KEY 或 OPENAI_API_KEY",
    });
    return;
  }

  try {
    const result = await runAgent(
      "service",
      {
        question: "减脂期能喝拿铁吗？",
        metrics: normalizeMetrics({ weather: "晴天", revenue: 2680, cups: 96, ticket: 28 }),
      },
      `{ "question": "顾客问题", "reply": "可直接发送的回复" }`,
    );

    res.json({ ok: true, provider, model, result });
  } catch (error) {
    res.status(500).json({ ok: false, provider, model, error: error.message });
  }
});

app.post("/api/workflows/daily", async (req, res) => {
  const metrics = normalizeMetrics(req.body || {});
  const question = field(req.body?.question, "减脂期能喝拿铁吗？");

  if (provider === "local-fallback" || provider === "invalid-config") {
    res.json(localFallback(metrics, question));
    return;
  }

  try {
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

    const [contentAgent, serviceAgent] = await Promise.all([
      runAgent(
        "content",
        { metrics, dataAgent, productAgent },
        `{ "topic": "选题", "title": "标题", "cover": "封面文案", "videoStructure": ["结构"], "body": "小红书正文", "commentGuide": "评论区引导" }`,
      ),
      runAgent(
        "service",
        { question, metrics, productAgent },
        `{ "question": "顾客问题", "reply": "可直接发送的回复" }`,
      ),
    ]);

    const managerAgent = await runAgent(
      "manager",
      { metrics, dataAgent, productAgent, contentAgent, serviceAgent },
      `{ "summary": "今日总判断", "priority": ["优先动作"], "report": "完整日报文本" }`,
    );

    res.json({
      mode: `${provider}-agents`,
      dataAgent,
      productAgent,
      contentAgent,
      serviceAgent,
      managerAgent,
    });
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

  if (provider === "local-fallback" || provider === "invalid-config") {
    res.json(localFallback(metrics, question).serviceAgent);
    return;
  }

  try {
    const productAgent = await runAgent(
      "product",
      { metrics },
      `{ "heroProduct": "主推产品组合", "audience": ["适合人群"], "avoid": ["避开项"], "staffScript": "员工推荐话术" }`,
    );
    const serviceAgent = await runAgent(
      "service",
      { question, metrics, productAgent },
      `{ "question": "顾客问题", "reply": "可直接发送的回复" }`,
    );

    res.json(serviceAgent);
  } catch (error) {
    res.status(500).json({
      error: "customer_workflow_failed",
      message: error.message,
      fallback: localFallback(metrics, question).serviceAgent,
    });
  }
});

app.listen(port, () => {
  console.log(`Lanpo coffee ops running on http://localhost:${port}`);
});
