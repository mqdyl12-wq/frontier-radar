#!/usr/bin/env python3
"""Collect academic metadata and official updates without inventing results."""
from __future__ import annotations

import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "feed.json"
ATOM = "{http://www.w3.org/2005/Atom}"
TERMS = (
    "AI-mediated communication", "AI summaries public discussion",
    "generative AI social media",
)
AI_RE = re.compile(r"\b(?:AI[- ]mediated|generative AI|AIGC|large language model|LLMs?|chatbot|algorithmic|artificial intelligence|AI summar(?:y|ies|ization)|AI overviews?|generative search|GPT[- 0-9])\b", re.I)
COMM_RE = re.compile(
    r"\\b(?:communicat|social media|politic|public|news|journalis|discourse|discussion"
    r"|opinion|emotion|misinformation|summari|normative|participat|interperson"
    r"|search (?:engine|result|interface)|information (?:exposure|retrieval)"
    r"|media (?:use|effect)|platform (?:governance|content))\\w*", re.I
)
TECH_TITLE_RE = re.compile(
    r"\\b(?:Gemini(?:\\s+\\d+)?|GPT(?:-\\d+)?|Claude|DeepSeek|Qwen|"
    r"AI (?:search|overviews?|summar\\w*|discovery|for scientists|and children|"
    r"guidance|effect|research|models?|agents?)|generative|agents?|"
    r"(?:embedded )?assessments?|evaluat\\w*|benchmarks?|"
    r"news|journalis\\w*|media|reasoning|retrieval|RAG|multimodal|"
    r"open[- ]weights?|scientists use|researchers?|AI[- ]mediated)\\b|"
    r"\\bIntroducing ChatGPT\\b", re.I
)
FEEDS = (
    ("OpenAI 官方动态", "https://openai.com/news/rss.xml", "openai.com"),
    ("Google DeepMind 官方博客", "https://deepmind.google/blog/rss.xml", "deepmind.google"),
)

def clean(text: str, limit: int = 400) -> str:
    text = re.sub(r"<[^>]*>", " ", str(text or ""))
    text = re.sub(r"\s+", " ", html.unescape(text)).strip()
    return text[:limit] + ("…" if len(text) > limit else "")

def stable_id(url: str, kind: str) -> str:
    match = re.search(r"(?:doi\.org/|doi:)(10\.\d{4,9}/[^\s?#]+)", url, re.I)
    normalized = ("doi:" + match.group(1).lower().rstrip("/")) if match else url.strip().lower().rstrip("/")
    return kind + "-" + hashlib.sha256(normalized.encode()).hexdigest()[:18]

def request(url: str) -> bytes:
    req = urllib.request.Request(url, headers={
        "User-Agent": "FrontierRadar/1.1 (academic metadata indexing)",
        "Accept": "application/json,application/xml,text/xml,*/*",
    })
    with urllib.request.urlopen(req, timeout=25) as response:
        return response.read(2_500_000)

def date_parts(value: dict) -> str:
    parts = (value.get("date-parts") or [[]])[0]
    return "-".join([str(parts[0])] + [f"{p:02d}" for p in parts[1:]]) if parts else "未知"

def fetch_crossref(since: str) -> list[dict]:
    found = []
    succeeded = 0
    for index, term in enumerate(TERMS):
        if index:
            time.sleep(1.5)  # Reduce Crossref request bursts.
        query = urllib.parse.urlencode({
            "query.bibliographic": term, "filter": f"from-created-date:{since}",
            "sort": "updated", "order": "desc", "rows": 30,
        })
        try:
            items = json.loads(request("https://api.crossref.org/works?" + query))["message"]["items"]
            succeeded += 1
        except Exception as exc:
            print(f"WARNING Crossref ({term}): {exc}", file=sys.stderr)
            continue
        for item in items:
            title = clean((item.get("title") or [""])[0], 240)
            doi = item.get("DOI")
            if not doi or not relevant_paper(title):
                continue
            pub = item.get("published-online") or item.get("published") or item.get("issued") or {}
            published = date_parts(pub)
            created = item.get("created", {}).get("date-time", "")[:10]
            authors = ", ".join(" ".join(filter(None, (a.get("given"), a.get("family"))))
                                for a in item.get("author", [])[:6])
            abstract = clean(item.get("abstract", ""))
            url = "https://doi.org/" + doi
            found.append({
                "id": stable_id(url, "p"), "title": title, "en": title,
                "authors": authors or "作者未提供", "date": published, "discoveredAt": created,
                "venue": (item.get("container-title") or ["Crossref 登记记录"])[0],
                "type": "工作论文" if item.get("type") == "posted-content" else "正式发表",
                "topic": ["AI摘要"] if re.search(r"summar|overview|search", title, re.I) else ["AI-MC"],
                "public": False, "method": "未核对全文；不能仅凭题录判定研究方法。",
                "question": "自动发现候选文献；研究问题尚待核对。",
                "finding": ("来源提供的摘要（未核对全文）：" + abstract if abstract else
                            "自动获取题录，未提供摘要；不推断研究发现。"),
                "scope": f"Crossref 登记日期 {created or '未知'}；出版日期 {published}；未核对全文。",
                "significance": "题名与研究方向相关；是否直接研究公共讨论尚待判定。",
                "tags": ["自动收录", "待精读", "Crossref"], "url": url,
            })
    if not succeeded:
        raise RuntimeError("All Crossref requests failed")
    return unique(found)

def fetch_arxiv(since: datetime) -> list[dict]:
    query = ('all:"AI-mediated communication" OR all:"social media summarization" '
             'OR all:"generative search" OR all:"AI Overviews" OR all:"opinion climate"')
    params = urllib.parse.urlencode({
        "search_query": query, "start": 0, "max_results": 100,
        "sortBy": "submittedDate", "sortOrder": "descending",
    })
    root = ET.fromstring(request("https://export.arxiv.org/api/query?" + params))
    found = []
    for entry in root.findall(f"{ATOM}entry"):
        title = clean(entry.findtext(f"{ATOM}title"), 240)
        summary = clean(entry.findtext(f"{ATOM}summary"))
        first = entry.findtext(f"{ATOM}published") or ""
        updated = entry.findtext(f"{ATOM}updated") or first
        if not updated or datetime.fromisoformat(updated.replace("Z", "+00:00")) < since:
            continue
        url = entry.findtext(f"{ATOM}id") or ""
        if not url.startswith("https://arxiv.org/abs/"):
            continue
        authors = ", ".join(clean(a.findtext(f"{ATOM}name"), 80)
                            for a in entry.findall(f"{ATOM}author")[:6])
        found.append({
            "id": stable_id(url, "p"), "title": title, "en": title,
            "authors": authors or "作者未提供",
            "date": first[:10], "updatedAt": updated[:10], "venue": "arXiv（预印本）",
            "type": "工作论文", "topic": ["AI摘要"], "public": False,
            "method": "预印本，研究方法需核对全文。",
            "question": "依据题名和摘要筛选，研究问题需进一步确认。",
            "finding": "作者摘要（未核对全文）：" + summary,
            "scope": f"arXiv 首次发布 {first[:10]}，最新修订 {updated[:10]}；未核对全文。",
            "significance": "候选研究；公共讨论属性尚未核查。",
            "tags": ["自动收录", "预印本", "待精读"], "url": url,
        })
    return found

def day_from_rss(value: str) -> str:
    if not value:
        return ""
    try:
        return parsedate_to_datetime(value).date().isoformat()
    except (ValueError, TypeError):
        return value[:10]

def fetch_rss(source: str, feed_url: str, domain: str, since_day: str) -> list[dict]:
    root = ET.fromstring(request(feed_url))
    entries = root.findall("./channel/item") or root.findall(f"{ATOM}entry")
    found = []
    for entry in entries:
        atom = entry.tag.endswith("entry")
        title = clean(entry.findtext(f"{ATOM}title" if atom else "title"), 240)
        if atom:
            url = next((el.get("href") for el in entry.findall(f"{ATOM}link")
                        if el.get("rel") in (None, "alternate")), "")
        else:
            url = entry.findtext("link") or ""
        url = url.strip()
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme != "https" or (
            parsed.hostname != domain and not (parsed.hostname or "").endswith("." + domain)
        ):
            continue
        date = day_from_rss(entry.findtext(f"{ATOM}published" if atom else "pubDate")
                            or entry.findtext(f"{ATOM}updated") or "")
        if date and date < since_day:
            continue
        summary = clean(entry.findtext(f"{ATOM}summary" if atom else "description"))
        if not relevant_tech(title):
            continue
        found.append({
            "id": stable_id(url, "t"), "title": title, "date": date or "日期待核查",
            "source": source, "excerpt": "官方 RSS 摘要（未阅读全文核对）：" +
            (summary or "摘要缺失，详见官方原文。"),
            "impact": "研究启发待补充；不能仅凭标题判断效果。",
            "tags": ["自动收录", "官方动态"], "url": url,
        })
    return found

def relevant_paper(title: str) -> bool:
    return bool(AI_RE.search(title) and COMM_RE.search(title))

def relevant_tech(title: str) -> bool:
    return bool(TECH_TITLE_RE.search(title))

def unique(records: list[dict]) -> list[dict]:
    by_id = {}
    for item in records:
        by_id.setdefault(item["id"], item)
    return sorted(by_id.values(), key=lambda x: x.get("date", ""), reverse=True)

def main() -> None:
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=int(os.getenv("LOOKBACK_DAYS", "7")))
    successes = 0
    errors = []
    try:
        papers_crossref = fetch_crossref(since.date().isoformat())
        successes += 1
    except Exception as exc:
        papers_crossref = []
        errors.append(f"Crossref: {exc}")
    try:
        papers_arxiv = fetch_arxiv(since)
        successes += 1
    except Exception as exc:
        papers_arxiv = []
        errors.append(f"arXiv: {exc}")
    tech_new = []
    for name, url, domain in FEEDS:
        try:
            tech_new.extend(fetch_rss(name, url, domain, since.date().isoformat()))
            successes += 1
        except Exception as exc:
            errors.append(f"{name}: {exc}")
    if not successes:
        raise RuntimeError("All sources failed: previous feed preserved")
    old = json.loads(OUTPUT.read_text(encoding="utf-8")) if OUTPUT.exists() else {}
    # Keep past curated records only if they meet today's relevance criteria.
    # This removes low-value RSS/Crossref records from the first deployment.
    papers = unique([p for p in old.get("papers", []) if relevant_paper(p.get("title", ""))]
                    + papers_crossref + papers_arxiv)
    technology = unique([t for t in old.get("tech", []) if relevant_tech(t.get("title", ""))]
                        + tech_new)
    result = {
        "date": now.date().isoformat(), "checkedAt": now.isoformat(),
        "label": f"自动收录 · 最近一次检索 {now.strftime('%Y-%m-%d %H:%M UTC')}",
        "papers": papers[:950], "tech": technology[:950],
        "opportunities": old.get("opportunities", []),
        "sources": ["Crossref", "arXiv", *[name for name, _, _ in FEEDS]],
        "issues": errors,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix(".tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(OUTPUT)
    print(f"Success: {len(papers_crossref) + len(papers_arxiv)} papers, "
          f"{len(tech_new)} technology posts; {len(errors)} source errors")
    for issue in errors:
        print("WARNING", issue, file=sys.stderr)

if __name__ == "__main__":
    main()
