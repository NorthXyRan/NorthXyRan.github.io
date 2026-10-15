// Dependency-free browser behavior regressions: node --test scripts/test_site.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../assets/js/site.js"), "utf8");

function page() {
  const listeners = new Map();
  const viewport = { matches: false, addEventListener: (_, callback) => { viewport.change = callback; } };
  let document;

  // Only the buttons replaced by the real renderer need a DOM in these tests.
  class Element {
    constructor(attributes = {}, parent = null) {
      this.attributes = attributes;
      this.parentElement = parent;
      this.dataset = {};
      this.children = [];
      this.style = {};
      this.disabled = "disabled" in attributes;
      Object.entries(attributes).forEach(([key, value]) => {
        if (key.startsWith("data-")) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      });
      const classes = new Set((attributes.class || "").split(/\s+/));
      this.classList = {
        contains: (name) => classes.has(name),
        toggle(name, force) {
          if (force ?? !classes.has(name)) classes.add(name);
          else classes.delete(name);
        },
      };
    }
    set innerHTML(html) {
      if (document && this.contains(document.activeElement)) document.activeElement = document.body;
      this.html = html;
      this.children = Array.from(html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g), ([, attributes, body]) => {
        const values = {};
        for (const [, name, value] of attributes.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) values[name] = value ?? "";
        const button = new Element(values, this);
        button.textContent = body.replace(/<[^>]+>/g, "").trim();
        return button;
      });
    }
    get innerHTML() { return this.html || ""; }
    matches(selector) {
      if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
      const [, attribute, value] = selector.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/) || [];
      return attribute !== undefined && attribute in this.attributes && (value === undefined || this.attributes[attribute] === value);
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    contains(element) { return Boolean(element && (element === this || this.children.some((child) => child.contains(element)))); }
    querySelector(selector) { return this.children.find((child) => child.matches(selector)) || null; }
    getAttribute(name) { return this.attributes[name]; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    focus() { if (!this.disabled) document.activeElement = this; }
  }

  const pager = new Element();
  const tabs = new Element();
  const ids = new Map([["news-list", new Element()], ["pub-list", new Element()]]);
  document = {
    body: new Element(),
    querySelector: (selector) => ({ ".pager": pager, ".pub-tabs": tabs })[selector] || null,
    querySelectorAll: (selector) => tabs.children.filter((child) => child.matches(selector)),
    getElementById: (id) => ids.get(id),
    addEventListener: (event, callback) => listeners.set(event, callback),
  };
  document.activeElement = document.body;
  const context = vm.createContext({
    document,
    window: { location: { href: "https://example.org/" }, matchMedia: () => viewport },
    HTMLElement: Element,
    URL,
    console: { error() {} },
    fetch: async () => ({ ok: true, json: async () => [] }),
  });
  vm.runInContext(source, context);
  return {
    context, document, pager, tabs, viewport,
    publications(records) {
      context.records = records;
      vm.runInContext("PUBS = records.map(normalizePublication); renderPublicationFilters(); renderPubs();", context);
    },
    news(records) {
      context.records = records;
      vm.runInContext("NEWS = records; newsPage = 1; renderNews(); setupNewsPager();", context);
    },
    click(target) { listeners.get("click")({ target }); },
    html(id) { return ids.get(id).innerHTML; },
  };
}

function paper(title, metadata = {}) {
  return { title, year: 2026, authors: [{ name: "Ada" }], abstract_html: "", ...metadata };
}

test("keywords named All, spaces, hyphens, and quoted labels filter independently", () => {
  const view = page();
  view.publications([
    paper("All category paper", { keywords: ["All"] }),
    paper("Space category paper", { keywords: ["Human AI"] }),
    paper("Hyphen category paper", { keywords: ["Human-AI"] }),
    paper("Case variant paper", { keywords: [" HUMAN   AI "] }),
    paper("Quoted category paper", { keywords: ['Art & "HCI"'] }),
  ]);
  assert.equal(view.tabs.children.length, 5, "only case/whitespace variants share a category");
  for (const [label, expected, excluded] of [
    ["All", ["All category paper"], ["Space category paper"]],
    ["Human AI", ["Space category paper", "Case variant paper"], ["Hyphen category paper"]],
    ["Human-AI", ["Hyphen category paper"], ["Space category paper"]],
  ]) {
    const button = view.tabs.children.find((item) => item.textContent === label);
    assert.ok(button, `filter for ${label} exists`);
    view.click(button);
    expected.forEach((title) => assert.ok(view.html("pub-list").includes(title)));
    excluded.forEach((title) => assert.ok(!view.html("pub-list").includes(title)));
    assert.equal(button.getAttribute("aria-pressed"), "true");
  }
  view.click(view.tabs.children.find((item) => item.textContent.startsWith("Art &")));
  assert.ok(view.html("pub-list").includes("Quoted category paper"));
  assert.ok(view.tabs.innerHTML.includes("Art &amp; &quot;HCI&quot;"));
  view.click(view.tabs.children[0]);
  assert.equal((view.html("pub-list").match(/<article /g) || []).length, 5);
});

test("generic venue cards keep logos/resources optional and escape metadata and URLs", () => {
  const view = page();
  view.publications([paper('Title <img src=x> & "quoted"', {
    venue: "CHI 2026", venue_short: "CHI", venue_logo: "/images/chi.png", venue_url: "https://chi.example.org/",
    image: "/images/paper.png", pdf: '/pdf/paper.pdf?title="quoted"&page=1', code: "javascript:alert(1)",
    url: "https://example.org/paper?q=a&b=c", abstract_html: "<p>Abstract with <strong>Markdown</strong>.</p>",
    authors: [{ name: "Ada <Example>", url: 'https://example.org/?q="Ada"&x=1', emphasis: true }],
  })]);
  let html = view.html("pub-list");
  assert.ok(html.includes('class="venue-tag tag-chi"'));
  assert.ok(html.includes('src="/images/chi.png"'));
  assert.ok(html.includes('src="/images/paper.png"'));
  assert.ok(html.includes('href="/pdf/paper.pdf?title=&quot;quoted&quot;&amp;page=1"'));
  assert.ok(html.includes("<strong><a"));
  assert.ok(html.includes("Ada &lt;Example&gt;"));
  assert.ok(html.includes("Title &lt;img src=x&gt; &amp; &quot;quoted&quot;"));
  assert.ok(html.includes("<strong>Markdown</strong>"));
  assert.ok(!html.includes("javascript:"));
  assert.ok(!html.includes(">CODE<"));
  assert.ok(!html.includes("pub-card--no-image"));

  view.publications([paper("Journal article", { venue: "Example Journal", venue_short: "EJ" })]);
  html = view.html("pub-list");
  assert.ok(html.includes("Example Journal"));
  assert.ok(html.includes("pub-card--no-image"));
  assert.ok(html.includes("pub-header--no-logo"));
  assert.ok(!html.includes("pub-abstract-toggle"));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("<a "));
});

test("news pagination retains keyboard focus and updates when the viewport changes", () => {
  const view = page();
  view.news(Array.from({ length: 10 }, (_, index) => ({ date: `26/1/${index + 1}`, text: `<p>News ${index + 1}</p>` })));
  const pageButtons = () => view.pager.children.filter((button) => button.classList.contains("pager-num"));
  assert.equal(pageButtons().length, 4);
  view.viewport.matches = true;
  view.viewport.change();
  assert.equal(pageButtons().length, 2);
  for (let index = 0; index < 3; index++) {
    const next = view.pager.querySelector('[data-news-page="next"]');
    next.focus();
    view.click(next);
    assert.ok(view.pager.contains(view.document.activeElement), "focus stays in the pager after DOM replacement");
    assert.ok(!view.document.activeElement.disabled);
  }
  assert.ok(view.html("news-list").includes("News 10"));
  assert.ok(!view.html("news-list").includes("News 9"));
  assert.equal(view.document.activeElement.dataset.newsPage, "4", "the final page receives focus when Next becomes disabled");
  view.viewport.matches = false;
  view.viewport.change();
  assert.equal(pageButtons().length, 4);
});

test("unavailable or malformed JSON shows a load error, while an empty list is valid", async () => {
  const view = page();
  view.context.fetch = async () => ({ ok: false, status: 404 });
  await view.context.loadNewsFromJson();
  assert.ok(view.html("news-list").includes('role="alert"'));
  assert.ok(view.html("news-list").includes("Unable to load news"));
  view.context.fetch = async () => ({ ok: true, json: async () => null });
  await view.context.loadPubsFromJson();
  assert.ok(view.html("pub-list").includes("Unable to load publications"));
  view.context.fetch = async () => ({ ok: true, json: async () => [] });
  await view.context.loadPubsFromJson();
  assert.ok(view.html("pub-list").includes("No publications yet."));
  assert.ok(!view.html("pub-list").includes('role="alert"'));
});
