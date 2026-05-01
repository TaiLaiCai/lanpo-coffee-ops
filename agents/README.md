# 蓝珀咖啡 5 Agent 配置

每个文件代表一个独立 Agent 的职责和个性：

- `manager.md`：店长总控 Agent
- `data.md`：数据复盘 Agent
- `product.md`：咖啡产品 Agent
- `content.md`：内容运营 Agent
- `service.md`：私域客服 Agent

后端 Router 会在运行时读取这些文件，并按工作流协作：

1. 数据 Agent 分析经营问题
2. 产品 Agent 根据数据推荐主推产品
3. 内容 Agent 和客服 Agent 并行生成内容/话术
4. 店长总控 Agent 汇总为最终日报

修改 Agent 个性或职责时，只改对应 Markdown 文件即可。
