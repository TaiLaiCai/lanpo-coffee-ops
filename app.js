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
    revenue: Number(fields.revenue.value || 0),
    cups: Number(fields.cups.value || 0),
    ticket: Number(fields.ticket.value || 0),
    views: Number(fields.views.value || 0),
    engagement: Number(fields.engagement.value || 0),
    weather: fields.weather.value,
  };
}

function yuan(value) {
  return `¥${Math.round(value).toLocaleString("zh-CN")}`;
}

function getDiagnosis(data) {
  const engagementRate = data.views ? data.engagement / data.views : 0;

  if (data.revenue < 1800 && data.ticket >= 26) {
    return {
      issue: "客单价稳定，但营业额偏低，主要问题更像是进店流量不足。",
      action: "今天把内容和门口物料都指向同一个场景：下午犯困、熬夜后想清醒。",
      alert: "建议做 14:00-17:00 第二杯半价，先补低峰杯量。",
    };
  }

  if (data.ticket < 24) {
    return {
      issue: "客流有基础，但客单价偏低，需要提升组合购买。",
      action: "主推咖啡 + 小食或升级燕麦奶，收银话术要自然带出。",
      alert: "今日重点看加购率，不急着降价。",
    };
  }

  if (engagementRate > 0.06 && data.revenue < 2600) {
    return {
      issue: "内容互动不错，但到店转化没有跟上，缺少明确门店引导。",
      action: "文案加入门店位置、到店福利和适合人群，让浏览变成行动。",
      alert: "评论区固定回复：滨江附近上班可以来店里试一杯。",
    };
  }

  return {
    issue: "经营数据整体平稳，今天适合做场景化主推和会员复购。",
    action: "上午发科普内容，下午推续命咖啡，晚间做老客唤醒。",
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

function buildManager(data) {
  const diagnosis = getDiagnosis(data);
  const weatherPlan = getWeatherPlan(data.weather);

  outputs.manager.innerHTML = `
    <p><strong>问题判断：</strong>${diagnosis.issue}</p>
    <p><strong>天气策略：</strong>${weatherPlan}</p>
    <ul>
      <li>上午：发布咖啡知识短内容，主题围绕“熬夜后怎么喝咖啡”。</li>
      <li>下午：执行“蓝珀下午续命计划”，提升低峰时段杯量。</li>
      <li>晚间：私域提醒老客明早可提前点单，减少等待。</li>
    </ul>
    <p><strong>老板提醒：</strong>${diagnosis.alert}</p>
  `;
}

function buildContent(data) {
  const locationHint =
    data.views > 1000 ? "正文结尾加一句：滨江附近上班的朋友，可以来店里试试。" : "先把标题钩子做强，提升浏览和收藏。";

  outputs.content.innerHTML = `
    <p><strong>今日选题：</strong>《熬夜后第二天咖啡怎么喝？》</p>
    <p><strong>标题：</strong>熬夜党别乱喝咖啡，越喝越困可能是这个原因</p>
    <ul>
      <li>开头钩子：你以为困了就该马上喝咖啡吗？</li>
      <li>误区解释：刚醒皮质醇高，马上灌咖啡不一定更清醒。</li>
      <li>正确喝法：起床后 60-90 分钟喝，中杯就够，不建议太晚。</li>
      <li>到店引导：今天蓝珀主推冰美式和低糖燕麦拿铁。</li>
    </ul>
    <p><strong>发布提醒：</strong>${locationHint}</p>
  `;
}

function buildProduct(data) {
  const product =
    data.weather === "高温" || data.weather === "晴天"
      ? "冰美式 + 低糖燕麦拿铁"
      : "热澳白 + 热拿铁";
  const avoid =
    data.ticket < 24 ? "单杯低价成交，收银时补一句“要不要加一份小食”。" : "摩卡、焦糖玛奇朵、厚乳系列不适合减脂话题主推。";

  outputs.product.innerHTML = `
    <p><strong>今日主推：</strong>${product}</p>
    <p><strong>适合人群：</strong>上班族、减脂期女生、熬夜后需要清醒的人。</p>
    <ul>
      <li>低负担推荐：冰美式、燕麦拿铁、澳白。</li>
      <li>话术重点：少糖、清爽、下午不容易腻。</li>
      <li>避开提醒：${avoid}</li>
    </ul>
  `;
}

function buildReport(data) {
  const diagnosis = getDiagnosis(data);
  const product =
    data.weather === "高温" || data.weather === "晴天"
      ? "冰美式 / 低糖燕麦拿铁"
      : "热拿铁 / 澳白";

  outputs.report.textContent = `蓝珀咖啡每日运营日报

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
蓝珀下午续命计划，周一到周五 14:00-17:00，任意咖啡第二杯半价。

员工重点动作：
1. 门口立牌改为“熬夜后喝什么咖啡”
2. 收银优先推荐今日主推产品
3. 记录顾客对低糖、燕麦奶、冰饮的反馈
4. 下午低峰时段提醒老客可到店或外卖下单

老板提醒：
${diagnosis.alert}`;
}

function answerQuestion() {
  const question = $("#customerQuestion").value.trim();
  const isLatte = /拿铁|latte/i.test(question);
  const isFatLoss = /减脂|减肥|控糖|热量/.test(question);

  const reply =
    isLatte && isFatLoss
      ? "可以喝，但建议选中杯、少糖或不加糖，奶可以换成燕麦奶或低脂奶。如果你下午容易困，拿铁比甜饮更稳；如果今天热量控制比较严格，也可以选冰美式。你在附近的话，来蓝珀我可以按低糖口味帮你做。"
      : "可以的，我建议按你的时间和口味来选。如果想清爽一点选美式，想顺滑一点选拿铁或澳白，太晚就不建议喝大杯。你告诉我今天想提神还是想轻松喝一杯，我可以帮你配。";

  outputs.service.innerHTML = `<p>${reply}</p>`;
}

function generateAll() {
  const data = getData();
  buildManager(data);
  buildContent(data);
  buildProduct(data);
  buildReport(data);
  answerQuestion();
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
  field.addEventListener("change", generateAll);
  field.addEventListener("input", generateAll);
});

generateAll();
