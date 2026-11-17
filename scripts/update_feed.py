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
    r"\b(?:communicat|social media|politic|public|news|journalis|discourse|discussion"
    r"|opinion|emotion|misinformation|summari|normative|participat|interperson"
    r"|search (?:engine|result|interface)|information (?:exposure|retrieval)"
    r"|media (?:use|effect)|platform (?:governance|content))\w*", re.I
)
TECH_TITLE_RE = re.compile(
    r"\b(?:Gemini(?:\s+\d+)?|GPT(?:-\d+)?|Claude|DeepSeek|Qwen|"
    r"AI (?:search|overviews?|summar\w*|discovery|for scientists|and children|"
    r"guidance|effect|research|models?|agents?)|generative|agents?|"
    r"(?:embedded )?assessments?|evaluat\w*|benchmarks?|"
    r"news|journalis\w*|media|reasoning|retrieval|RAG|multimodal|"
    r"open[- ]weights?|scientists use|researchers?|AI[- ]mediated)\b|"
    r"\bIntroducing ChatGPT\b", re.I
)

# Manually maintained editorial priority lists; not a live JIF / quartile claim.
COMMUNICATION_JOURNALS = {
    "journalofcomputermediatedcommunication", "newmediasociety",
    "communicationresearch", "communicationtheory", "journalofcommunication",
    "humancommunicationresearch", "informationcommunicationsociety",
    "socialmediasociety", "digitaljournalism", "politicalcommunication",
    "theinternationaljournalofpresspolitics", "internationaljournalofpresspolitics",
    "journalismmasscommunicationquarterly", "journalismstudies",
    "computationalcommunicationresearch", "communicationmethodsandmeasures",
    "bigdatasociety",
}
INTERDISCIPLINARY_JOURNALS = {
    "science", "scienceadvances", "nature", "naturehumanbehaviour",
    "naturecommunications", "scientificreports", "pnas", "pnasnexus",
    "proceedingsofthenationalacademyofsciences", "informationsystemsresearch",
    "journalofmanagementinformationsystems", "internetresearch",
    "computersinhumanbehavior", "computersinhumanbehaviorreports",
    "acmtransactionsoncomputerhumaninteraction",
}
PEER_REVIEWED_CONFERENCES = ("chi", "cscw", "emnlp", "acl", "icwsm", "webconference")
TOPIC_PATTERNS = {
    "AI中介传播与AI信息中介": r"AI[- ]mediated|AI[- ]powered (?:search|communication)|generative (?:search|AI)|large language model|\bLLM\b|chatgpt|AI overviews?|intelligent (?:search|agents?)",
    "AI内容趋同": r"converg|homogen|similarity|diversity|opinion align|narrowing|semantic|standardization|collective creativ",
    "意见气候": r"climate of opinion|spiral of silence|descriptive norms?|normative influence|conformity|majority opinion|public opinion|opinion dynamics",
    "AI摘要与公众意见": r"AI (?:generated )?summari|AI summaries|AI overviews?|information summar|generative summar",
}
def venue_key(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").casefold())

def venue_tier(venue: str, kind: str = "journal") -> str:
    if kind == "preprint":
        return "预印本（非同行评议）"
    normalized = venue_key(venue)
    if normalized in COMMUNICATION_JOURNALS:
        return "传播学重点／专业期刊"
    if normalized in INTERDISCIPLINARY_JOURNALS:
        return "交叉学科重点期刊"
    if any(word in normalized for word in PEER_REVIEWED_CONFERENCES) and kind == "conference":
        return "重要同行评议会议"
    return ""

def topic_tags(title: str, abstract: str = "") -> list[str]:
    content = (title + " " + abstract)[:6500]
    return [label for label, pattern in TOPIC_PATTERNS.items() if re.search(pattern, content, re.I)]

def relevance_tier(themes: list[str]) -> str:
    if "AI摘要与公众意见" in themes and ("意见气候" in themes or "AI内容趋同" in themes):
        return "直接相关"
    if "AI摘要与公众意见" in themes or "意见气候" in themes:
        return "重点关注"
    return "方法／理论参考"

FEEDS = (
    ("OpenAI 官方动态", "https://openai.com/news/rss.xml", "openai.com"),
    ("Google DeepMind 官方博客", "https://deepmind.google/blog/rss.xml", "deepmind.google"),
    ("Google AI 官方博客", "https://blog.google/innovation-and-ai/technology/ai/rss/", "blog.google"),
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
            venue = clean((item.get("container-title") or [""])[0], 200)
            tier = venue_tier(venue)
            if not tier:  # Do not market arbitrary-indexed journals as high impact.
                continue
            abstract = clean(item.get("abstract", ""), 6200)
            themes = topic_tags(title, abstract)
            if not themes:
                continue
            pub = item.get("published-online") or item.get("published") or item.get("issued") or {}
            published = date_parts(pub)
            created = item.get("created", {}).get("date-time", "")[:10]
            authors = ", ".join(" ".join(filter(None, (a.get("given"), a.get("family"))))
                                for a in item.get("author", [])[:6])
            url = "https://doi.org/" + doi
            found.append({
                "id": stable_id(url, "p"), "title": title, "en": title,
                "authors": authors or "作者未提供", "date": published, "discoveredAt": created,
                "venue": venue, "sourceTier": tier, "researchThemes": themes,
                "relevance": relevance_tier(themes), "abstract": abstract,
                "analysisStatus": "待解读",
                "type": "工作论文" if item.get("type") == "posted-content" else "正式发表",
                "topic": ["AI摘要"] if re.search(r"summar|overview|search", title, re.I) else ["AI-MC"],
                "public": False, "method": "未核对全文；不能仅凭题录判定研究方法。",
                "question": "自动发现候选文献；研究问题尚待核对。",
                "finding": ("来源提供的摘要（未核对全文）：" + abstract if abstract else
                            "自动获取题录，未提供摘要；不推断研究发现。"),
                "scope": f"Crossref 登记日期 {created or '未知'}；出版日期 {published}；仅使用可获取元数据与摘要，未核对全文。",
                "significance": "题名与研究方向相关；是否直接研究公共讨论尚待判定。",
                "tags": ["自动收录", "待精读", "Crossref", tier], "url": url,
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
    try:
        raw = request("https://export.arxiv.org/api/query?" + params)
    except Exception as exc:
        # arXiv documents official daily Atom feeds; useful if its search API is throttled.
        print(f"WARNING arXiv search API unavailable: {exc}; trying daily category feed.",
              file=sys.stderr)
        time.sleep(3)  # arXiv requests must be separated by at least 3 seconds.
        raw = request("https://rss.arxiv.org/atom/cs.SI")
    root = ET.fromstring(raw)
    if root.tag != ATOM + "feed":
        raise ValueError("arXiv response is not an Atom feed")
    found = []
    for entry in root.findall(f"{ATOM}entry"):
        title = clean(entry.findtext(f"{ATOM}title"), 240)
        summary = clean(entry.findtext(f"{ATOM}summary"), 6200)
        if not relevant_paper(title + " " + summary):
            continue
        first = entry.findtext(f"{ATOM}published") or ""
        updated = entry.findtext(f"{ATOM}updated") or first
        if not updated or datetime.fromisoformat(updated.replace("Z", "+00:00")) < since:
            continue
        url = entry.findtext(f"{ATOM}id") or ""
        if url.startswith("http://arxiv.org/abs/"):
            url = "https://" + url.removeprefix("http://")
        if not url.startswith("https://arxiv.org/abs/"):
            continue
        authors = ", ".join(clean(a.findtext(f"{ATOM}name"), 80)
                            for a in entry.findall(f"{ATOM}author")[:6])
        themes = topic_tags(title, summary)
        found.append({
            "id": stable_id(url, "p"), "title": title, "en": title,
            "authors": authors or "作者未提供",
            "date": first[:10], "updatedAt": updated[:10], "venue": "arXiv（预印本）",
            "type": "工作论文", "topic": ["AI摘要"], "public": False,
            "researchThemes": themes, "relevance": relevance_tier(themes),
            "sourceTier": "预印本（非同行评议）", "abstract": summary,
            "analysisStatus": "待解读",
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
    by_key = {}
    for item in records:
        source = item.get("url", "").lower()
        doi = re.search(r"doi.org/(10\\.\\d{4,9}/[^?#]+)", source)
        key = doi.group(1) if doi else source.rstrip("/") or item["id"]
        by_key.setdefault(key, item)
    return sorted(by_key.values(), key=lambda x: x.get("date", ""), reverse=True)

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
    curated = json.loads((ROOT / "data" / "curated_library.json").read_text(encoding="utf-8"))["papers"]
    papers = unique(
        curated +
        [p for p in old.get("papers", []) if p.get("curated")
         or p.get("sourceTier") == "预印本（非同行评议）"
         or (venue_tier(p.get("venue", "")) and relevant_paper(p.get("en", p.get("title", ""))))]
        + papers_crossref + papers_arxiv
    )
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
