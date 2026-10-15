"""Content-contract tests: python3 -m unittest discover -s scripts -p 'test_*.py'."""

from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build import BuildError, build_site


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.write("templates/index.html", "<article>{{ bio }}</article>\n<section>{{ service }}</section>\n<aside>{{ miscellaneous }}</aside>\n")
        self.write("contents/bio.md", "Hello **world**.")
        self.write("contents/service.md", "## Reviewer\n\nACM CHI 2027")
        self.write("contents/miscellaneous.md", "I play *piano*.")
        self.write("contents/news.md", "## Pinned 📌\n\nWelcome.\n\n## 2026-08-21\n\nStarted!")

    def write(self, name, content):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    def publication(self, name="paper.md", *, body="My **abstract**.", **overrides):
        metadata = {"title": "A paper", "year": 2026, "authors": [{"name": "Ada Example", "emphasis": True}]}
        metadata.update(overrides)
        return self.write("contents/publications/" + name, "---\n" + yaml.safe_dump(metadata, sort_keys=False) + "---\n\n" + body)

    def read_json(self, name):
        return json.loads((self.root / "data" / name).read_text(encoding="utf-8"))

    def test_markdown_sections_preserve_hooks_and_escape_raw_html(self):
        self.write("contents/bio.md", '[Advisor](https://example.org/ "advisor") and [Lab](HTTPS://EXAMPLE.ORG/lab).\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))')
        self.publication()
        build_site(self.root)
        html = (self.root / "index.html").read_text()
        self.assertIn('class="blue-link" target="_blank" rel="noopener">Advisor</a>', html)
        self.assertNotIn('title="advisor"', html)
        self.assertIn('<a href="HTTPS://EXAMPLE.ORG/lab" target="_blank" rel="noopener">Lab</a>', html)
        self.assertIn('&lt;script&gt;alert(1)&lt;/script&gt;', html)
        self.assertNotIn('<script>', html)
        self.assertNotIn('href="javascript:', html)
        self.assertIn('<h3 class="service-heading"><span class="section-marker" aria-hidden="true">##</span> Reviewer</h3>', html)
        self.assertIn('<p class="service-venue">ACM CHI 2027</p>', html)
        self.assertIn('<p>I play <em>piano</em>.</p>', html)
        self.assertIn('<p>My <strong>abstract</strong>.</p>', self.read_json("publications.json")[0]["abstract_html"])

    def test_placeholder_text_in_content_is_not_replaced(self):
        self.write("contents/bio.md", "Literal {{ service }}")
        build_site(self.root)
        self.assertIn("Literal {{ service }}", (self.root / "index.html").read_text())

    def test_news_dates_order_markdown_and_code_fences(self):
        self.write("contents/news.md", "## 2026-08-21\n\nFirst **news**.\n\n```text\n## This is code\n```\n\n## Pinned 📌\n\n[Welcome](https://example.org/).\n\n## 2024-02-29\n\nLeap day.")
        build_site(self.root)
        news = self.read_json("news.json")
        self.assertEqual([item["date"] for item in news], ["26/8/21", "Pinned 📌", "24/2/29"])
        self.assertIn("<strong>news</strong>", news[0]["text"])
        self.assertIn("## This is code", news[0]["text"])
        self.assertIn('rel="noopener"', news[1]["text"])

    def test_news_reference_links_are_shared_across_entries(self):
        self.write("contents/news.md", "[top]: https://example.org/top\n\n## 2026-08-21\n\nRead [paper][bottom] and [top].\n\n## Pinned 📌\n\nAlso read [paper][bottom].\n\n[bottom]: https://example.org/paper\n")
        build_site(self.root)
        first, second = self.read_json("news.json")
        self.assertIn('href="https://example.org/top"', first["text"])
        for entry in (first, second):
            self.assertIn('<a href="https://example.org/paper" target="_blank" rel="noopener">paper</a>', entry["text"])

    def test_news_unicode_line_separators_do_not_change_entry_boundaries(self):
        self.write("contents/news.md", "## 2026-08-21\n\nA\u2028B\u0085C\n\n## 2026-07-01\n\nNext entry.")
        build_site(self.root)
        first, second = self.read_json("news.json")
        self.assertEqual(first["text"], "<p>A\u2028B\u0085C</p>")
        self.assertEqual(second["text"], "<p>Next entry.</p>")

    def test_publication_discovery_years_resources_and_arbitrary_keywords(self):
        self.publication("z.md", title="2026 paper")
        self.publication("b.md", title="Resource paper", keywords=["Education", "Robotics & Art"], pdf="/pdf/paper.pdf", code="https://example.org/code", authors=[{"name": "Ada", "url": "https://example.org/", "emphasis": False}])
        self.publication("nested/c.md", title="Nested paper", year=2025)
        self.publication("newer.md", title="Newest", year=2027, keywords="Visual Analytics, An entirely new category")
        self.publication("_paper.md", title="Underscore filename")
        self.publication("_collection/paper.md", title="Underscore directory")
        build_site(self.root)
        publications = self.read_json("publications.json")
        self.assertEqual([paper["year"] for paper in publications], [2027, 2026, 2026, 2026, 2026, 2025])
        self.assertEqual({paper["title"] for paper in publications}, {"Newest", "2026 paper", "Resource paper", "Nested paper", "Underscore filename", "Underscore directory"})
        self.assertEqual(publications[0]["keywords"], "Visual Analytics, An entirely new category")
        paper = next(paper for paper in publications if paper["title"] == "Resource paper")
        self.assertEqual(paper["keywords"], ["Education", "Robotics & Art"])
        self.assertEqual(paper["pdf"], "/pdf/paper.pdf")
        self.assertEqual(paper["code"], "https://example.org/code")
        self.assertNotIn("video", paper)
        self.assertEqual(paper["authors"][0]["emphasis"], False)
        self.assertEqual(paper["abstract_html"], "<p>My <strong>abstract</strong>.</p>")
        self.assertNotIn("abstract", paper)

    def test_generic_venue_fields_and_optional_venue(self):
        self.publication("journal.md", title="Journal paper", venue="IEEE Transactions on Visualization and Computer Graphics", venue_short="TVCG", venue_logo="/images/tvcg.png", venue_url="https://example.org/journal")
        self.publication("no-venue.md", title="Preprint")
        self.publication("empty-venue.md", title="Empty venue", venue=" ")
        self.publication("conference.md", title="Conference paper", venue="CHI 2026", venue_short="CHI", venue_logo="/images/chi.png", venue_url="https://example.org/chi")
        build_site(self.root)
        publications = {paper["title"]: paper for paper in self.read_json("publications.json")}
        journal = publications["Journal paper"]
        self.assertEqual(journal["venue"], "IEEE Transactions on Visualization and Computer Graphics")
        self.assertEqual(journal["venue_short"], "TVCG")
        self.assertEqual(journal["venue_logo"], "/images/tvcg.png")
        self.assertEqual(journal["venue_url"], "https://example.org/journal")
        self.assertNotIn("venue", publications["Preprint"])
        self.assertEqual(publications["Empty venue"]["venue"], "")
        self.assertEqual(publications["Conference paper"]["venue_short"], "CHI")

    def test_missing_or_empty_publication_directory_is_valid(self):
        build_site(self.root)
        self.assertEqual(self.read_json("publications.json"), [])
        (self.root / "contents" / "publications").mkdir()
        self.assertEqual(build_site(self.root), [])
        self.write("contents/news.md", "")
        build_site(self.root)
        self.assertEqual(self.read_json("news.json"), [])

    def test_invalid_metadata_has_filename_and_field(self):
        cases = [
            ({"title": ""}, "title"),
            ({"year": True}, "year"),
            ({"year": "2026"}, "year"),
            ({"year": 2026.5}, "year"),
            ({"year": 5}, "year"),
            ({"authors": []}, "authors"),
            ({"authors": ["Ada"]}, "authors[0]"),
            ({"authors": [{"name": ""}]}, "authors[0].name"),
            ({"authors": [{"name": "Ada", "emphasis": "yes"}]}, "emphasis"),
            ({"keywords": ["HCI", 5]}, "keywords[1]"),
            ({"keywords": False}, "keywords"),
            ({"pdf": ["paper.pdf"]}, "pdf"),
            ({"image": None}, "image"),
            ({"order": 1}, "unknown publication field(s): order"),
            ({"url": "javascript:alert(1)"}, "url"),
            ({"venue": "CHI", "venu": "CHI"}, "venu"),
            ({"venue": []}, "venue"),
            ({"venue_short": False}, "venue_short"),
            ({"venue_logo": 5}, "venue_logo"),
            ({"venue_url": "javascript:alert(1)"}, "venue_url"),
        ]
        for overrides, field in cases:
            with self.subTest(overrides=overrides):
                path = self.publication(**overrides)
                with self.assertRaises(BuildError) as error:
                    build_site(self.root)
                self.assertIn(str(path), str(error.exception))
                self.assertIn(field, str(error.exception))

    def test_front_matter_errors(self):
        for source, message in [
            ("title: No delimiters", "metadata between ---"),
            ("---\ntitle: Missing end", "closing ---"),
            ("---\n- not a mapping\n---", "mapping"),
            ("---\ntitle: A\ntitle: B\n---", "duplicate"),
            ("---\ntitle: [invalid\n---", "invalid publication metadata"),
        ]:
            with self.subTest(source=source):
                path = self.write("contents/publications/bad.md", source)
                with self.assertRaises(BuildError) as error:
                    build_site(self.root)
                self.assertIn(str(path), str(error.exception))
                self.assertIn(message, str(error.exception))

    def test_indented_yaml_delimiter_stays_inside_block_scalar(self):
        self.write("contents/publications/multiline.md", "---\ntitle: |\n  A multiline title\n  ---\n  continued\nyear: 2026\nauthors:\n  - name: Ada\n---\n\nThe actual abstract.")
        build_site(self.root)
        paper = self.read_json("publications.json")[0]
        self.assertEqual(paper["title"], "A multiline title\n---\ncontinued")
        self.assertEqual(paper["abstract_html"], "<p>The actual abstract.</p>")

    def test_invalid_news_dates_preamble_and_empty_entry(self):
        for source in ["## 2026-02-29\n\nInvalid", "## 26/8/21\n\nInvalid", "Preface\n\n## 2026-08-21\n\nNews", "## 2026-08-21\n\n", "## 2026-08-21\n\n[unused]: https://example.org/"]:
            with self.subTest(source=source):
                path = self.write("contents/news.md", source)
                with self.assertRaises(BuildError) as error:
                    build_site(self.root)
                self.assertIn(str(path), str(error.exception))

    def test_invalid_input_leaves_all_existing_outputs_untouched(self):
        self.publication()
        build_site(self.root)
        outputs = [self.root / "index.html", self.root / "data/news.json", self.root / "data/publications.json"]
        before = {path: (path.read_bytes(), path.stat().st_mtime_ns) for path in outputs}
        self.write("contents/bio.md", "A valid edit that must not be written yet.")
        self.publication(year="not a year")
        with self.assertRaises(BuildError):
            build_site(self.root)
        self.assertEqual(before, {path: (path.read_bytes(), path.stat().st_mtime_ns) for path in outputs})

    def test_writes_only_changed_outputs(self):
        self.publication()
        changed = build_site(self.root)
        self.assertEqual(len(changed), 3)
        mtimes = {path: path.stat().st_mtime_ns for path in changed}
        self.assertEqual(build_site(self.root), [])
        self.assertEqual(mtimes, {path: path.stat().st_mtime_ns for path in changed})
        self.write("contents/bio.md", "Updated bio.")
        self.assertEqual(build_site(self.root), [self.root / "index.html"])
        for path in changed[1:]:
            self.assertEqual(path.stat().st_mtime_ns, mtimes[path])

    def test_bad_template_does_not_produce_outputs(self):
        self.write("templates/index.html", "{{ bio }} {{ service }} {{ bio }}")
        with self.assertRaisesRegex(BuildError, "exactly one"):
            build_site(self.root)
        self.assertFalse((self.root / "index.html").exists())
        self.assertFalse((self.root / "data").exists())


if __name__ == "__main__":
    unittest.main()
