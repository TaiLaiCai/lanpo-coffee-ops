import express from "express";
import OpenAI from "openai";

const app = express();
const port = Number(process.env.PORT || 3000);
const provider = process.env.MINIMAX_API_KEY
  ? "minimax"
  : process.env.OPENAI_API_KEY
    ? "openai"
    : "local-fallback";
const model =
  provider === "minimax"
    ? process.env.MINIMAX_MODEL || "MiniMax-M2.7"
    : process.env.OPENAI_MODEL || "gpt-5.2";
const client =
  provider === "minimax"
    ? new OpenAI({
        apiKey: process.env.MINIMAX_API_KEY,
        baseURL: process.env.MINIMAX_BASE_URL || "https://api.minimax.io/v1",
      })
    : provider === "openai"
      ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      : null;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(process.cwd(), { extensions: ["html"] }));

const agentInstructions = {
  data: `你是蓝珀咖啡的数据复盘 Agent。
职责：根据营业额、杯量、客单价、内容浏览、互动、天气，判断经营问题和明日优先动作。
输出要具体、短句、可执行。不要编造不存在的数据。`,
  product: `你是蓝珀咖啡的咖啡产品 Agent。
职责：根据天气、经营数据、用户场景，推荐今日主推咖啡、搭配、避开项和员工推荐话术。
必须兼顾咖啡专业性、减脂/熬夜/上班族场景和门店转化。`,
  content: `你是蓝珀咖啡的内容运营 Agent。
职责：生产小红书、抖音和朋友圈内容方案。
输出必须包含选题、标题、短视频结构、正文要点、封面文案、评论区引导。
风格：像真实咖啡店账号，不空泛，不营销腔。`,
  service: `你是蓝珀咖啡的私域客服 Agent。
职责：把顾客问题转成专业、温和、有转化的微信/社群回复。
回复要自然，避免医疗承诺，咖啡因和睡眠建议要谨慎。`,
  manager: `你是蓝珀咖啡店长总控 Agent。
职责：整合数据、产品、内容、客服/活动建议，生成老板能直接执行的每日运营日报。
输出要有判断、有动作、有优先级。`,
};

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

async function runAgent(name, payload, schemaHint) {
  if (!client) {
    throw new Error("MINIMAX_API_KEY or OPENAI_API_KEY is not configured.");
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

  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: JSON.stringify(payload, null, 2),
      },
    ],
    temperature: 0.7,
    max_completion_tokens: 2048,
  });

  return extractJson(response.choices?.[0]?.message?.content || "");
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

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    mode: client ? `${provider}-agents` : "local-fallback",
    model: client ? model : null,
  });
});

app.post("/api/workflows/daily", async (req, res) => {
  const metrics = normalizeMetrics(req.body || {});
  const question = field(req.body?.question, "减脂期能喝拿铁吗？");

  if (!client) {
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

  if (!client) {
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
