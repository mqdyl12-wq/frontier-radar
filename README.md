# 智能传播与 AI 前沿雷达

本仓库提供一个浏览器端阅读界面和独立的每日自动收录流程。

## 部署

1. 仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
2. 仓库 **Settings → Actions → General → Workflow permissions** 确认 `GITHUB_TOKEN` 允许写入仓库内容。如需更改此设置，请在 GitHub 网页操作。
3. 在 **Actions → Update frontier radar → Run workflow** 手动运行一次。
4. 等待采集与部署两项任务成功，然后在 Settings → Pages 获取正式网址；通常是 `https://mqdyl12-wq.github.io/frontier-radar/`。
5. 之后每天 **北京时间 08:17** 自动执行（UTC 00:17，GitHub 队列可导致延迟）。

## 架构和数据

- `index.html`：保留原有 UI，网页会尝试读取 `data/feed.json` 并与本地阅读资料合并。
- `scripts/update_feed.py`：只使用 Python 标准库，检索 Crossref、arXiv、OpenAI 和 Google DeepMind 的公开元数据/API/RSS。
- `data/feed.json`：工作流成功后生成并提交更新，静态网页读取这份公开文件。
- `.github/workflows/update-and-deploy.yml`：定时采集、提交 JSON 和部署 Pages。
- `supabase/personal_reading.sql`：**可选的下一阶段**个人笔记数据库模板，当前网页尚未连接 Supabase。

**重要限制**：
- 这是自动收录题录与官方摘要的首个可部署版本，不能等同于每天经人工核验的深度研究日报。
- AI 生成的研究方法、论文发现、理论分析目前没有接入；没有阅读全文的论文均标明证据范围。
- 若多个来源全部失败，采集程序会报错并保留上一份日报。
- 如果某个来源返回空结果或不可访问，请查阅 GitHub Actions 日志；不保证全网覆盖。
- 用户阅读笔记、收藏和进度目前存放在当前浏览器的 localStorage，不会跨设备同步；也不会上传到公开仓库。
- **切勿把私密研究材料、API Key、密码写入仓库。** 所有公开 Pages 内容均可被外界访问。
- 这个定时采集程序与 ChatGPT 已建立的每日日报提醒是**两个独立系统**，不会自动相互写入。
- 超出 950 条文献和 950 条技术动态后需要设计数据库分页和归档，不能视为无限历史库。

## 本地检测

```bash
python -m unittest discover -s tests -v
python -m py_compile scripts/update_feed.py
```

## 后续增加功能

需要独立的 AI 摘要分析步骤（带事实来源回链）、Supabase Auth 登录、RLS 校验和前端同步；当前不应将 Supabase SQL 模板误认为已经实现了个人数据库服务。
