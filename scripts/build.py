#!/usr/bin/env python3
"""Build the existing static site from Markdown content.

Run ``python3 scripts/build.py`` after editing content, or import ``build_site``
from the development server. No build timestamps are emitted, so identical
content leaves the generated files untouched.
"""

from __future__ import annotations

import argparse
from datetime import date
import json
import os
from pathlib import Path
import re
import tempfile
from typing import Any
from urllib.parse import urlsplit

from markdown_it import MarkdownIt
import yaml


class BuildError(ValueError):
    """An input file could not be read or contains invalid site content."""


ROOT = Path(__file__).resolve().parents[1]
SECTIONS = ("bio", "service", "miscellaneous")
TEXT_FIELDS = (
    "venue", "venue_short", "venue_logo", "venue_url",
    "url", "image", "pdf", "video", "code", "slides",
)
URL_FIELDS = {
    "venue_logo", "venue_url",
    "url", "image", "pdf", "video", "code", "slides",
}
PUBLICATION_FIELDS = {"title", "year", "authors", "keywords", *TEXT_FIELDS}


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeError) as exc:
        raise BuildError(f"{path}: could not read file: {exc}") from exc


def _markdown(*, service: bool = False) -> MarkdownIt:
    md = MarkdownIt("commonmark", {"html": False})

    def link_open(tokens, index, options, env):
        token = tokens[index]
        if token.attrGet("title") == "advisor":
            token.attrSet("class", "blue-link")
            token.attrs.pop("title", None)
        href = token.attrGet("href") or ""
        if href.lower().startswith(("http://", "https://", "//")):
            token.attrSet("target", "_blank")
            token.attrSet("rel", "noopener")
        return md.renderer.renderToken(tokens, index, options, env)

    md.renderer.rules["link_open"] = link_open

    if service:
        def heading_open(tokens, index, options, env):
            token = tokens[index]
            if token.tag == "h2":
                token.tag = "h3"
                token.attrSet("class", "service-heading")
                return (
                    md.renderer.renderToken(tokens, index, options, env)
                    + '<span class="section-marker" aria-hidden="true">##</span> '
                )
            return md.renderer.renderToken(tokens, index, options, env)

        def heading_close(tokens, index, options, env):
            if tokens[index].tag == "h2":
                tokens[index].tag = "h3"
            return md.renderer.renderToken(tokens, index, options, env)

        def paragraph_open(tokens, index, options, env):
            tokens[index].attrSet("class", "service-venue")
            return md.renderer.renderToken(tokens, index, options, env)

        md.renderer.rules.update({
            "heading_open": heading_open,
            "heading_close": heading_close,
            "paragraph_open": paragraph_open,
        })

    return md


def _news(path: Path) -> list[dict[str, str]]:
    source = _read(path)
    md = _markdown()
    # Reference-style link definitions belong to the whole Markdown file,
    # even though each news entry is rendered separately below.
    environment: dict[str, Any] = {}
    tokens = md.parse(source, environment)
    headings = [
        (token.map, tokens[index + 1].content)
        for index, token in enumerate(tokens)
        if token.type == "heading_open" and token.tag == "h2" and token.level == 0
    ]
    if not headings:
        if source.strip():
            raise BuildError(f"{path}: news entries must start with ## YYYY-MM-DD or ## Pinned 📌")
        return []

    # Markdown counts LF lines. str.splitlines() also splits Unicode paragraph
    # separators, which would put these slices out of sync with token maps.
    lines = source.split("\n")
    if md.render("\n".join(lines[:headings[0][0][0]]), environment).strip():
        raise BuildError(f"{path}: put news content below a ## YYYY-MM-DD or ## Pinned 📌 heading")

    entries = []
    for index, (line_map, label) in enumerate(headings):
        label = label.strip()
        if label == "Pinned 📌":
            display_date = label
        else:
            try:
                if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", label):
                    raise ValueError("expected YYYY-MM-DD")
                parsed = date.fromisoformat(label)
            except ValueError as exc:
                raise BuildError(
                    f"{path}:{line_map[0] + 1}: invalid news date {label!r}; "
                    "use YYYY-MM-DD or Pinned 📌"
                ) from exc
            display_date = f"{parsed.year % 100:02d}/{parsed.month}/{parsed.day}"
        end = headings[index + 1][0][0] if index + 1 < len(headings) else len(lines)
        body = "\n".join(lines[line_map[1]:end]).strip()
        text = md.render(body, environment).strip()
        if not text:
            raise BuildError(f"{path}:{line_map[0] + 1}: news entry {label!r} has no content")
        entries.append({"date": display_date, "text": text})
    return entries


class _MetadataLoader(yaml.SafeLoader):
    """Safe YAML with duplicate fields rejected instead of silently discarded."""


def _unique_mapping(loader, node, deep=False):
    mapping = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if not isinstance(key, str):
            raise ValueError("metadata field names must be strings")
        if key in mapping:
            raise ValueError(f"duplicate metadata field {key!r}")
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


_MetadataLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _unique_mapping,
)


def _front_matter(path: Path) -> tuple[dict[str, Any], str]:
    lines = _read(path).splitlines(keepends=True)
    if not lines or lines[0].rstrip() != "---":
        raise BuildError(f"{path}: start each publication with YAML metadata between --- lines")
    end = next((index for index in range(1, len(lines)) if lines[index].rstrip() == "---"), None)
    if end is None:
        raise BuildError(f"{path}: missing closing --- for publication metadata")
    try:
        metadata = yaml.load("".join(lines[1:end]), Loader=_MetadataLoader)
    except (yaml.YAMLError, ValueError) as exc:
        raise BuildError(f"{path}: invalid publication metadata: {exc}") from exc
    if not isinstance(metadata, dict):
        raise BuildError(f"{path}: publication metadata must be a mapping of field names to values")
    return metadata, "".join(lines[end + 1:]).strip()


def _string(value: Any, path: Path, field: str, *, required: bool = False) -> str:
    if not isinstance(value, str) or (required and not value.strip()):
        kind = "nonempty string" if required else "string (omit unused fields or use \"\")"
        raise BuildError(f"{path}: {field} must be a {kind}")
    return value.strip()


def _url(value: str, path: Path, field: str) -> str:
    # These fields become href/src attributes. Support normal web URLs and
    # relative site assets; reject executable schemes and malformed addresses.
    try:
        parsed = urlsplit(value)
    except ValueError as exc:
        raise BuildError(f"{path}: {field} is not a valid URL or relative path") from exc
    if (
        parsed.scheme.lower() not in ("", "http", "https")
        or any(ord(character) < 32 for character in value)
        or "\\" in value
        or (parsed.scheme and not parsed.netloc)
    ):
        raise BuildError(f"{path}: {field} must be an http(s) URL or relative path")
    return value


def _publication(path: Path) -> dict[str, Any]:
    metadata, body = _front_matter(path)
    unknown = set(metadata) - PUBLICATION_FIELDS
    if unknown:
        raise BuildError(f"{path}: unknown publication field(s): {', '.join(sorted(unknown))}")
    publication: dict[str, Any] = {
        "title": _string(metadata.get("title"), path, "title", required=True),
    }
    year = metadata.get("year")
    if type(year) is not int or not 1800 <= year <= 2200:
        raise BuildError(f"{path}: year must be an integer between 1800 and 2200")
    publication["year"] = year
    authors = metadata.get("authors")
    if not isinstance(authors, list) or not authors:
        raise BuildError(f"{path}: authors must be a nonempty list of records containing name")
    publication["authors"] = []
    for index, author in enumerate(authors):
        field = f"authors[{index}]"
        if not isinstance(author, dict):
            raise BuildError(f"{path}: {field} must be a record containing name")
        unknown = set(author) - {"name", "url", "emphasis"}
        if unknown:
            raise BuildError(f"{path}: unknown {field} field(s): {', '.join(sorted(unknown))}")
        record: dict[str, Any] = {"name": _string(author.get("name"), path, f"{field}.name", required=True)}
        if "url" in author:
            record["url"] = _url(_string(author["url"], path, f"{field}.url"), path, f"{field}.url")
        if "emphasis" in author:
            if type(author["emphasis"]) is not bool:
                raise BuildError(f"{path}: {field}.emphasis must be true or false")
            record["emphasis"] = author["emphasis"]
        publication["authors"].append(record)

    for field in TEXT_FIELDS:
        if field not in metadata:
            continue
        value = _string(metadata[field], path, field)
        publication[field] = _url(value, path, field) if field in URL_FIELDS else value
    if "keywords" in metadata:
        keywords = metadata["keywords"]
        if isinstance(keywords, str):
            publication["keywords"] = keywords.strip()
        elif isinstance(keywords, list):
            publication["keywords"] = [
                _string(keyword, path, f"keywords[{index}]", required=True)
                for index, keyword in enumerate(keywords)
            ]
        else:
            raise BuildError(f"{path}: keywords must be a string or list of strings")
    publication["abstract_html"] = _markdown().render(body).strip()
    return publication


def _publications(directory: Path) -> list[dict[str, Any]]:
    records = [
        _publication(path)
        for path in sorted(directory.rglob("*.md"))
    ]
    records.sort(key=lambda record: record["year"], reverse=True)
    return records


def _write_if_changed(path: Path, content: str) -> bool:
    if path.exists() and path.read_text(encoding="utf-8") == content:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, prefix=".build-", delete=False) as file:
            temporary = Path(file.name)
            file.write(content)
        temporary.chmod(0o644)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return True


def build_site(root: Path | str = ROOT) -> list[Path]:
    """Validate all sources, generate site outputs, and return changed paths.

    Validation errors raise BuildError before any output is written. Every
    Markdown file in contents/publications is included. News follows file
    order; publications sort by descending year.
    """
    root = Path(root).resolve()
    template_path = root / "templates" / "index.html"
    template = _read(template_path)
    rendered_sections = {}
    for section in SECTIONS:
        placeholder = "{{ " + section + " }}"
        if template.count(placeholder) != 1:
            raise BuildError(f"{template_path}: expected exactly one {placeholder} placeholder")
        rendered_sections[placeholder] = _markdown(service=section == "service").render(
            _read(root / "contents" / f"{section}.md")
        ).strip()
    # Replace in one pass: literal placeholder-like text in content is content.
    html = re.sub(r"\{\{ (bio|service|miscellaneous) \}\}", lambda match: rendered_sections[match[0]], template)
    news = _news(root / "contents" / "news.md")
    publications = _publications(root / "contents" / "publications")
    outputs = {
        root / "index.html": html,
        root / "data" / "news.json": json.dumps(news, ensure_ascii=False, indent=2) + "\n",
        root / "data" / "publications.json": json.dumps(publications, ensure_ascii=False, indent=2) + "\n",
    }
    return [path for path, content in outputs.items() if _write_if_changed(path, content)]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root (defaults to the script's repository)")
    args = parser.parse_args()
    try:
        changed = build_site(args.root)
    except (BuildError, OSError) as exc:
        parser.exit(1, f"Build failed: {exc}\n")
    print(f"Build complete: {len(changed)} file(s) updated.")


if __name__ == "__main__":
    main()
