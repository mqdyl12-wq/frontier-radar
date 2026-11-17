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

## 在研课题文献与来源分层（2026-11）

网页新增“在研课题参考”，按四条研究主题分组：

- AI中介传播与AI信息中介
- AI内容趋同
- 意见气候
- AI摘要与公众意见

已核对的公共学术成果整理在 `data/curated_library.json`。它不会上传私人论文或手稿全文。发表来源通过编辑维护的白名单分类为“传播学重点／专业期刊”“交叉学科重点期刊”“重要同行评议会议”以及单独的预印本候选。**这些标签不表示动态核验过最新 JCR 影响因子或分区**。

新文献记录可包含 `researchThemes`、`relevance`、`sourceTier`、`theory`、`abstract`、`analysisStatus` 和 `scope`。公共讨论识别具有单独的证据说明；未核验的新文献不会自动声明已经证实集体表达效应。

## 激活可选的每日中文结构化学术解读

已接入 `scripts/enrich_feed.py`，使用官方 OpenAI Responses API 的 Structured Outputs，以作者可公开获得的摘要作为唯一证据；英文题名翻译为中文，并尝试整理理论、数据/方法、研究发现、局限性和研究启发。未读取全文时明确标记为“摘要级AI解读”，**绝不宣称已经核对全文**。人工核对的参考文献不会被 AI 覆盖。

启用时需要你自行配置 OpenAI API 密钥（与 ChatGPT 订阅分别计费）：

1. 登录 OpenAI API 平台，创建 API Key；请勿发送给其他人或粘贴到公开仓库。
2. 打开 GitHub 仓库 **Settings → Secrets and variables → Actions → New repository secret**。
3. Name 填写 `OPENAI_API_KEY`，Secret 填写 API Key，保存。
4. 在 Actions → Update frontier radar → Run workflow 手动运行一次，并检查步骤 “Optional Chinese academic review (abstract-grounded)”。
5. 当前模型别名 `gpt-4.1-mini`，上限每次 5 篇有足够摘要的非人工核对论文；可修改 Actions 中的 `OPENAI_MODEL` 与 `MAX_AI_REVIEWS`，并应在 API 控制台设置费用预算。

如果没有设置密钥，自动数据采集与网页发布仍继续运行，但自动中文解读会明确跳过，不产生费用。论文摘要缺失时，不生成臆测的理论、方法或结论。模型的输出仍需人工审读，尤其是涉及理论论证和定量结果时。

当前未实现自动访问所有付费期刊全文。进一步的“全文级深度精读”需要合法获取的开放全文或机构订阅权限，并增加逐段核查与页码/段落来源链接。

## 验证

```bash
python -m py_compile scripts/update_feed.py scripts/enrich_feed.py
python -m unittest discover -s tests -v
node --check research_ui.js
```

GitHub Actions 在发布前运行以上检查，采集成功后提交 `data/feed.json` 并部署 Pages。
