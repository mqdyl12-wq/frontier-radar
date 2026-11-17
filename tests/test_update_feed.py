import importlib.util
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

PATH = Path(__file__).resolve().parents[1] / "scripts" / "update_feed.py"
spec = importlib.util.spec_from_file_location("update_feed", PATH)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

CROSSREF = {
    "message": {"items": [
        {"title": ["AI-mediated communication in social media discussions"],
         "DOI": "10.9999/example", "created": {"date-time": "2026-11-17T00:00:00Z"},
         "published-online": {"date-parts": [[2026, 11, 17]]},
         "type": "journal-article", "author": [{"given": "A", "family": "Author"}],
         "container-title": ["Sample Journal"]},
        {"title": ["Unrelated topic"], "DOI": "10.9999/irrelevant"}
    ]}
}
ARXIV = b"""<feed xmlns="http://www.w3.org/2005/Atom"><entry>
<id>https://arxiv.org/abs/2601.12345</id>
<title>AI summaries in discussions</title><summary>Preprint abstract</summary>
<published>2026-11-17T00:00:00Z</published>
<updated>2026-11-17T01:00:00Z</updated>
<author><name>A. Author</name></author></entry></feed>"""
RSS = b"""<rss><channel>
<item><title>AI Research Announcement</title><link>https://openai.com/index/ai-research/</link>
<description>Official source</description><pubDate>Tue, 17 Nov 2026 00:00:00 GMT</pubDate></item>
<item><title>Bad link</title><link>https://example.com/unsafe</link>
<pubDate>Tue, 17 Nov 2026 00:00:00 GMT</pubDate></item>
</channel></rss>"""

class TestFeed(unittest.TestCase):
    def test_crossref(self):
        with patch.object(mod, "request", return_value=json.dumps(CROSSREF).encode()):
            items = mod.fetch_crossref("2026-11-16")
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["type"], "正式发表")
        self.assertFalse(items[0]["public"])

    def test_arxiv(self):
        with patch.object(mod, "request", return_value=ARXIV):
            items = mod.fetch_arxiv(datetime(2026, 11, 16, tzinfo=timezone.utc))
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["type"], "工作论文")

    def test_rss_domain(self):
        with patch.object(mod, "request", return_value=RSS):
            items = mod.fetch_rss("OpenAI", "https://openai.com/news/rss.xml",
                                  "openai.com", "2026-11-16")
        self.assertEqual(len(items), 1)

    def test_relevance_filters(self):
        self.assertTrue(mod.relevant_paper("AI-mediated communication in social media discussions"))
        self.assertFalse(mod.relevant_paper(
            "What Is a Source? In Search of Authorship: From Princess Diana’s Trademark to Generative AI"
        ))
        self.assertTrue(mod.relevant_tech("Introducing Gemini 4 Hydrogen"))
        self.assertTrue(mod.relevant_tech("LVMH’s Media Division announces strategic partnership with OpenAI"))
        self.assertFalse(mod.relevant_tech(
            "Strengthening the fight against online child sexual abuse with new tools and support"
        ))

    def test_preserves_old_feed_when_all_fail(self):
        with tempfile.TemporaryDirectory() as d:
            output = Path(d) / "feed.json"
            original = '{"papers":[],"tech":[],"opportunities":[]}'
            output.write_text(original)
            with patch.object(mod, "OUTPUT", output), \
                 patch.object(mod, "fetch_crossref", side_effect=RuntimeError("failed")), \
                 patch.object(mod, "fetch_arxiv", side_effect=RuntimeError("failed")), \
                 patch.object(mod, "fetch_rss", side_effect=RuntimeError("failed")):
                with self.assertRaises(RuntimeError):
                    mod.main()
            self.assertEqual(output.read_text(), original)

if __name__ == "__main__":
    unittest.main()
