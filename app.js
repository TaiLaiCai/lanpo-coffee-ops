const $ = (selector) => document.querySelector(selector);

const fields = {
  revenue: $("#revenue"),
  cups: $("#cups"),
  ticket: $("#ticket"),
  views: $("#views"),
  engagement: $("#engagement"),
  weather: $("#weather"),
};

const outputs = {
  manager: $("#managerOutput"),
  content: $("#contentOutput"),
  product: $("#productOutput"),
  report: $("#dailyReport"),
  service: $("#serviceOutput"),
};

const today = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "long",
}).format(new Date());

function getData() {
  return {
    date: today,
    revenue: Number(fields.revenue.value || 0),
    cups: Number(fields.cups.value || 0),
    ticket: Number(fields.ticket.value || 0),
    views: Number(fields.views.value || 0),
    engagement: Number(fields.engagement.value || 0),
    weather: fields.weather.value,
    question: $("#customerQuestion").value.trim(),
  };
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function yuan(value) {
  return `¥${Math.round(value).toLocaleString("zh-CN")}`;
}

function list(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return "";
  }

  return `<ul>${items.map((item) => `<li>${escapeHTML(item)}</li>`).join("")}</ul>`;
}

function setStatus(mode) {
  const status = document.querySelector(".status");
  if (!status) return;
  status.textContent = mode === "openai-agents" ? "真实 Agent" : "本地兜底";
}

function getDiagnosis(data) {
  const engagementRate = data.views ? data.engagement / data.views : 0;

  if (data.revenue < 1800 && data.ticket >= 26) {
    return {
      issue: "客单价稳定，但营业额偏低，主要问题更像是进店流量不足。",
      alert: "建议做 14:00-17:00 第二杯半价，先补低峰杯量。",
    };
  }

  if (data.ticket < 24) {
    return {
      issue: "客流有基础，但客单价偏低，需要提升组合购买。",
      alert: "今日重点看加购率，不急着降价。",
    };
  }

  if (engagementRate > 0.06 && data.revenue < 2600) {
    return {
      issue: "内容互动不错，但到店转化没有跟上，缺少明确门店引导。",
      alert: "评论区固定回复：滨江附近上班可以来店里试一杯。",
    };
  }

  return {
    issue: "经营数据整体平稳，今天适合做场景化主推和会员复购。",
    alert: "保持出杯稳定，重点收集顾客对主推产品的反馈。",
  };
}

function getWeatherPlan(weather) {
  const plans = {
    晴天: "适合主推冰美式、椰水美式和清爽低糖款。",
    阴天: "适合主推热拿铁、澳白和情绪陪伴型内容。",
    小雨: "适合主推热饮外带，内容角度可写雨天的一杯热拿铁。",
    高温: "适合主推冰饮、低糖和解腻组合，外卖图要突出清爽。",
    降温: "适合主推热拿铁、热美式和暖胃早餐组合。",
  };

  return plans[weather] || plans.晴天;
}

function localFallback(data) {
  const diagnosis = getDiagnosis(data);
  const product =
    data.weather === "高温" || data.weather === "晴天"
      ? "冰美式 + 低糖燕麦拿铁"
      : "热澳白 + 热拿铁";

  return {
    mode: "local-fallback",
    dataAgent: {
      issue: diagnosis.issue,
      signals: ["营业额", "杯量", "客单价", "内容互动"],
      risks: ["低峰时段销售不足"],
      actions: ["上午发布咖啡知识短内容", "下午执行第二杯半价", "私域提醒老客明早提前点单"],
    },
    productAgent: {
      heroProduct: product,
      audience: ["上班族", "减脂期女生", "熬夜后需要清醒的人"],
      avoid: ["摩卡、焦糖玛奇朵、厚乳系列不适合减脂话题主推"],
      staffScript: `今天主推${product}，清爽、低负担，适合下午提神。`,
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
      question: data.question,
      reply: "可以喝，但建议选中杯、少糖或不加糖。如果今天热量控制比较严格，可以选冰美式；想顺滑一点就选低糖拿铁。太晚不建议喝大杯。",
    },
    managerAgent: {
      summary: `${diagnosis.issue}${getWeatherPlan(data.weather)}`,
      priority: ["上午发布咖啡知识内容", "下午做第二杯半价", "评论区加入门店位置引导"],
      report: `蓝珀咖啡每日运营日报

日期：${today}
天气：${data.weather}
昨日营业额：${yuan(data.revenue)}
昨日杯量：${data.cups} 杯
客单价：${yuan(data.ticket)}
主销产品：美式、拿铁、澳白

问题判断：
${diagnosis.issue}

今日主推：
${product}

今日内容选题：
《熬夜后第二天咖啡怎么喝？》

今日活动：
蓝珀下午续命计划，14:00-17:00 任意咖啡第二杯半价。

员工重点动作：
1. 门口立牌改为“熬夜后喝什么咖啡”
2. 收银优先推荐今日主推产品
3. 记录顾客对低糖、燕麦奶、冰饮的反馈
4. 下午低峰时段提醒老客到店或外卖下单

老板提醒：
${diagnosis.alert}`,
    },
  };
}

function renderWorkflow(workflow) {
  const dataAgent = workflow.dataAgent || {};
  const productAgent = workflow.productAgent || {};
  const contentAgent = workflow.contentAgent || {};
  const serviceAgent = workflow.serviceAgent || {};
  const managerAgent = workflow.managerAgent || {};

  setStatus(workflow.mode);

  outputs.manager.innerHTML = `
    <p><strong>总控判断：</strong>${escapeHTML(managerAgent.summary || dataAgent.issue)}</p>
    <p><strong>数据 Agent：</strong>${escapeHTML(dataAgent.issue)}</p>
    ${list(dataAgent.actions)}
    <p><strong>优先级：</strong></p>
    ${list(managerAgent.priority)}
  `;

  outputs.product.innerHTML = `
    <p><strong>今日主推：</strong>${escapeHTML(productAgent.heroProduct)}</p>
    <p><strong>适合人群：</strong>${escapeHTML((productAgent.audience || []).join("、"))}</p>
    ${list(productAgent.avoid)}
    <p><strong>员工话术：</strong>${escapeHTML(productAgent.staffScript)}</p>
  `;

  outputs.content.innerHTML = `
    <p><strong>今日选题：</strong>《${escapeHTML(contentAgent.topic)}》</p>
    <p><strong>标题：</strong>${escapeHTML(contentAgent.title)}</p>
    <p><strong>封面：</strong>${escapeHTML(contentAgent.cover)}</p>
    ${list(contentAgent.videoStructure)}
    <p><strong>正文：</strong>${escapeHTML(contentAgent.body)}</p>
    <p><strong>评论引导：</strong>${escapeHTML(contentAgent.commentGuide)}</p>
  `;

  outputs.service.innerHTML = `<p>${escapeHTML(serviceAgent.reply)}</p>`;
  outputs.report.textContent = managerAgent.report || "";
}

function setLoading(isLoading) {
  $("#generateAll").disabled = isLoading;
  $("#answerQuestion").disabled = isLoading;
  $("#generateAll").textContent = isLoading ? "Agent 协作中..." : "生成今日方案";
}

async function requestWorkflow(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    if (data.fallback) {
      return data.fallback;
    }
    throw new Error(data.message || "Agent workflow failed.");
  }

  return data;
}

async function generateAll() {
  const payload = getData();
  setLoading(true);

  try {
    const workflow = await requestWorkflow("/api/workflows/daily", payload);
    renderWorkflow(workflow);
  } catch {
    renderWorkflow(localFallback(payload));
  } finally {
    setLoading(false);
  }
}

async function answerQuestion() {
  const payload = getData();
  $("#answerQuestion").disabled = true;
  outputs.service.innerHTML = "<p>客服 Agent 正在生成...</p>";

  try {
    const serviceAgent = await requestWorkflow("/api/workflows/customer", payload);
    outputs.service.innerHTML = `<p>${escapeHTML(serviceAgent.reply)}</p>`;
  } catch {
    outputs.service.innerHTML = `<p>${escapeHTML(localFallback(payload).serviceAgent.reply)}</p>`;
  } finally {
    $("#answerQuestion").disabled = false;
  }
}

$("#generateAll").addEventListener("click", generateAll);
$("#answerQuestion").addEventListener("click", answerQuestion);
$("#copyReport").addEventListener("click", async () => {
  await navigator.clipboard.writeText(outputs.report.textContent);
  $("#copyReport").textContent = "已复制";
  setTimeout(() => {
    $("#copyReport").textContent = "复制";
  }, 1200);
});

Object.values(fields).forEach((field) => {
  field.addEventListener("change", () => renderWorkflow(localFallback(getData())));
  field.addEventListener("input", () => renderWorkflow(localFallback(getData())));
});

renderWorkflow(localFallback(getData()));
