import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

PATH = Path(__file__).resolve().parents[1] / "scripts" / "enrich_feed.py"
spec = importlib.util.spec_from_file_location("enrich_feed", PATH)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class TestEnrichment(unittest.TestCase):
    def test_skips_insufficient_abstract(self):
        papers=[{"id":"one","abstract":"Short","title":"Example"}]
        with patch.object(mod,"model_analysis") as model:
            n=mod.enrich(papers,"test","gpt-4.1-mini",5)
        self.assertEqual(n,0)
        model.assert_not_called()
        self.assertEqual(papers[0]["analysisStatus"],"作者摘要不足，保留题录")

    def test_keeps_full_evidence_boundary(self):
        a={key:"摘要未说明" for key in mod.FIELDS}
        a.update(titleZh="AI中介传播测试",
                 discussionScope="直接研究公共讨论",
                 theory="作者摘要未说明理论框架")
        papers=[{"id":"two","title":"AI-mediated communication",
                 "en":"AI-mediated communication", "url":"https://doi.org/10.1000/valid",
                 "abstract":"This author abstract describes an online experiment about AI-mediated public discussion. "*4,
                 "curated":False,"public":False}]
        with patch.object(mod,"model_analysis",return_value=a):
            n=mod.enrich(papers,"test","gpt-4.1-mini",1)
        self.assertEqual(n,1)
        self.assertEqual(papers[0]["title"],"AI中介传播测试")
        self.assertEqual(papers[0]["analysisStatus"],"摘要级AI解读")
        self.assertFalse(papers[0]["public"])
        self.assertIn("未读取或核对全文",papers[0]["scope"])

    def test_manual_curated_is_not_overwritten(self):
        paper={"id":"curated","title":"人工核对","curated":True,
               "abstract":"long abstract text "*35}
        with patch.object(mod,"model_analysis") as model:
            self.assertEqual(mod.enrich([paper],"fake","gpt-4.1-mini",5),0)
        model.assert_not_called()
        self.assertEqual(paper["title"],"人工核对")

if __name__=="__main__":
    unittest.main()
