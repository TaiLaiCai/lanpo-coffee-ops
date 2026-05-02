# 蓝珀咖啡 AI 经营管理团队

这套 Agent 不是“机器人群聊”，而是一个用 AI 取代咖啡店核心部门的经营管理组织。设计参考高效率连锁精品咖啡的运营方式：快决策、强执行、稳定出品、数据驱动、内容转化。

## 组织结构

- `manager.md`：AI 区域运营总经理，负责最终取舍和日报
- `data.md`：AI 经营分析总监，负责数据判断和预警
- `product.md`：AI 产品研发与菜单负责人，负责产品策略和专业校验
- `content.md`：AI 新媒体增长负责人，负责内容和到店转化
- `service.md`：AI 私域与门店服务负责人，负责顾客话术和体验

## 协作链路

```text
数据 Agent
  ↓
产品 Agent
  ↓
内容 Agent + 客服 Agent
  ↓
店长总控 Agent
```

1. 数据复盘 Agent 先定义问题
2. 产品 Agent 根据问题决定主推产品和话术边界
3. 内容 Agent 和客户体验 Agent 并行执行：内容 Agent 生产拉新/转化内容，客户体验 Agent 生成私域、评论和顾客咨询回复
4. 店长总控 Agent 读取全部输出，做最后取舍，输出日报和执行清单

## 管理方式

每个 Agent 的个性、职责、禁区都在独立 Markdown 文件里。修改后重启服务即可生效：

```bash
sudo systemctl restart lanpo-coffee-ops
```
