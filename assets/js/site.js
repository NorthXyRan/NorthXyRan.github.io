let NEWS = [];
let PUBS = [];

let newsPage = 1;
const newsPerPage = 3;
let currentFilter = "all";

const THEME_KEY = "nx_theme";

// Add resource types here; papers only need the matching front matter field.
const PUBLICATION_RESOURCES = [
  { key: "pdf", label: "PDF", icon: "fa-solid fa-file-pdf" },
  { key: "video", label: "VIDEO", icon: "fa-solid fa-circle-play" },
  { key: "code", label: "CODE", icon: "fa-brands fa-github" },
  { key: "slides", label: "SLIDES", icon: "fa-solid fa-file-powerpoint" },
];

function escapeHtml(value) {
  const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(value ?? "").replace(/[&<>"']/g, (char) => entities[char]);
}

function resourceUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim(), window.location.href);
    return ["http:", "https:"].includes(url.protocol) ? value.trim() : "";
  } catch {
    return "";
  }
}

function categoryId(label) {
  // Keep user keywords separate from the built-in overview and from venue CSS
  // slugs: “All”, “Human AI”, and “Human-AI” are valid, distinct categories.
  return "keyword:" + encodeURIComponent(label.trim().toLowerCase().replace(/\s+/g, " "));
}

function venueClass(label) {
  return label.trim().toLowerCase().replace(/\s+/g, "-");
}

function normalizePublication(p) {
  const keywords = Array.isArray(p.keywords) ? p.keywords : String(p.keywords || "").split(",");
  return {
    title: p.title || "",
    year: Number(p.year) || 0,
    venue: p.venue || "",
    venueShort: p.venue_short || "",
    authors: Array.isArray(p.authors) ? p.authors : [],
    image: resourceUrl(p.image),
    url: resourceUrl(p.url),
    abstractHtml: p.abstract_html || "",
    venueLogo: resourceUrl(p.venue_logo),
    venueUrl: resourceUrl(p.venue_url),
    categories: keywords.map((keyword) => String(keyword).trim()).filter(Boolean)
      .map((label) => ({ id: categoryId(label), label })),
    resources: PUBLICATION_RESOURCES.map((resource) => ({
      ...resource,
      href: resourceUrl(p[resource.key]),
    })).filter((resource) => resource.href),
  };
}

function renderAuthors(authors) {
  return authors.filter((author) => author && author.name).map((author) => {
    let content = escapeHtml(author.name);
    const url = resourceUrl(author.url);
    if (url) content = `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${content}</a>`;
    if (author.emphasis) content = `<strong>${content}</strong>`;
    return content;
  }).join(", ");
}

function renderPublicationLinks(resources) {
  return resources.map(({ href, label, icon }) => `
    <a href="${escapeHtml(href)}" target="_blank" rel="noopener">
      <i class="${icon}" aria-hidden="true"></i><span>${label}</span>
    </a>
  `).join("");
}

function getStoredTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "dark" || t === "light" ? t : null;
  } catch {
    return null;
  }
}

function getSystemTheme() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;

  const btn = document.querySelector(".theme-btn");
  if (!btn) return;

  const next = theme === "dark" ? "light" : "dark";
  btn.setAttribute("aria-label", `Switch to ${next} mode`);
  btn.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
  btn.classList.toggle("is-dark", theme === "dark");
}

function setupThemeToggle() {
  const btn = document.querySelector(".theme-btn");
  if (!btn) return;

  const initial = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  applyTheme(initial);

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
  });

  // Follow system changes only when user hasn't set an explicit preference.
  const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  if (!mq) return;
  const onChange = () => {
    if (getStoredTheme() !== null) return;
    applyTheme(getSystemTheme());
  };
  if (typeof mq.addEventListener === "function") mq.addEventListener("change", onChange);
  else if (typeof mq.addListener === "function") mq.addListener(onChange);
}

function setupMenuNav() {
  const nav = document.querySelector(".mobile-nav");
  const btn = document.querySelector(".menu-btn");
  if (!nav || !btn) return;

  function openNav() {
    nav.classList.add("is-open");
    btn.classList.add("is-open");
    btn.setAttribute("aria-expanded", "true");
    btn.setAttribute("aria-label", "Close menu");
  }

  function closeNav() {
    nav.classList.remove("is-open");
    btn.classList.remove("is-open");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-label", "Open menu");
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (nav.classList.contains("is-open")) {
      closeNav();
    } else {
      openNav();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && nav.classList.contains("is-open")) {
      closeNav();
      btn.focus();
    }
  });

  nav.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    // Bio：只关闭目录并回到页面顶部，不跳锚点
    if (target.classList.contains("mobile-nav-link") && target.classList.contains("is-top")) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
      closeNav();
      return;
    }

    // 其它导航项：按默认锚点跳转，并关闭目录
    if (target.tagName === "A") {
      closeNav();
    }
  });

  document.addEventListener("click", (e) => {
    if (!nav.classList.contains("is-open")) return;
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.closest(".mobile-nav") && !target.closest(".menu-btn") && !target.closest(".theme-btn")) {
      closeNav();
    }
  });
}

function updatePager() {
  const pager = document.querySelector(".pager");
  if (!pager) return;
  const focusedButton = document.activeElement?.closest("[data-news-page]");
  const focusedPage = focusedButton && pager.contains(focusedButton) ? focusedButton.dataset.newsPage : null;

  const maxPage = Math.max(1, Math.ceil(NEWS.length / newsPerPage));
  const isMobile =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(max-width: 820px)").matches;

  if (maxPage <= 1) {
    pager.style.display = "none";
    newsPage = 1;
    return;
  }

  pager.style.display = "flex";

  let pagesHtml = "";

  if (isMobile) {
    // 在移动端最多只显示两个页码，如：
    // 当前在第 1 页：1, 2
    // 当前在第 2 页：2, 3
    // 当前在第 3 页：3, 4 ...
    const start = Math.min(newsPage, Math.max(1, maxPage - 1));
    const end = Math.min(maxPage, start + 1);
    for (let i = start; i <= end; i += 1) {
      pagesHtml += `<button class="pager-num${i === newsPage ? " is-active" : ""}" data-news-page="${i}" aria-label="News page ${i}"${i === newsPage ? ' aria-current="page"' : ""}>${i}</button>`;
    }
  } else {
    for (let i = 1; i <= maxPage; i += 1) {
      pagesHtml += `<button class="pager-num${i === newsPage ? " is-active" : ""}" data-news-page="${i}" aria-label="News page ${i}"${i === newsPage ? ' aria-current="page"' : ""}>${i}</button>`;
    }
  }

  pager.innerHTML = `
    <button class="pager-btn" data-news-page="prev" aria-label="Previous news page" ${newsPage === 1 ? "disabled" : ""}>‹</button>
    ${pagesHtml}
    <button class="pager-btn" data-news-page="next" aria-label="Next news page" ${newsPage === maxPage ? "disabled" : ""}>›</button>
  `;

  if (focusedPage) {
    const previous = pager.querySelector(`[data-news-page="${focusedPage}"]`);
    const current = pager.querySelector(`[data-news-page="${newsPage}"]`);
    (previous && !previous.disabled ? previous : current)?.focus();
  }
}

function setupNewsPager() {
  const viewport = window.matchMedia?.("(max-width: 820px)");
  if (!viewport) return;
  if (typeof viewport.addEventListener === "function") viewport.addEventListener("change", updatePager);
  else if (typeof viewport.addListener === "function") viewport.addListener(updatePager);
}

function renderNews() {
  const start = (newsPage - 1) * newsPerPage;
  const list = NEWS.slice(start, start + newsPerPage);
  const box = document.getElementById("news-list");
  box.innerHTML = list
    .map(
      (n) => `
      <article class="news-row">
        <div class="news-date">${escapeHtml(n.date)}</div>
        <div class="news-text">${n.text ?? ""}</div>
      </article>
    `
    )
    .join("") || '<p class="content-status">No news yet.</p>';

  updatePager();
}

async function loadJsonList(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  const parsed = await res.json();
  if (!Array.isArray(parsed) || parsed.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry))) {
    throw new Error(`Expected a list of records in ${path}`);
  }
  return parsed;
}

function showLoadError(id, label, error) {
  console.error(error);
  document.getElementById(id).innerHTML = `<p class="content-status" role="alert">Unable to load ${label}. Please refresh to try again.</p>`;
}

async function loadNewsFromJson() {
  try {
    NEWS = await loadJsonList("/data/news.json");
    newsPage = 1;
    renderNews();
  } catch (error) {
    showLoadError("news-list", "news", error);
  }
}

async function loadPubsFromJson() {
  try {
    PUBS = (await loadJsonList("/data/publications.json"))
      .map(normalizePublication)
      .sort((a, b) => b.year - a.year);
    renderPublicationFilters();
    renderPubs();
  } catch (error) {
    showLoadError("pub-list", "publications", error);
  }
}

function renderPublicationFilters() {
  const categories = new Map();
  PUBS.forEach((p) => p.categories.forEach(({ id, label }) => {
    if (!categories.has(id)) categories.set(id, label);
  }));
  if (currentFilter !== "all" && !categories.has(currentFilter)) currentFilter = "all";
  const filters = [["all", "All (by Year)"], ...Array.from(categories).sort((a, b) => a[1].localeCompare(b[1]))];
  document.querySelector(".pub-tabs").innerHTML = filters.map(([id, label]) => `
    <button type="button" class="tab${id === currentFilter ? " is-active" : ""}"
      data-filter="${escapeHtml(id)}" aria-pressed="${id === currentFilter}" aria-controls="pub-list">${escapeHtml(label)}</button>
  `).join("");
}

function renderPubs() {
  const data = PUBS.filter((p) => currentFilter === "all" || p.categories.some((category) => category.id === currentFilter));
  const box = document.getElementById("pub-list");
  box.innerHTML = data
    .map(
      (p, idx) => `
      <article class="pub-card${p.image ? "" : " pub-card--no-image"}">
        ${p.image ? `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.title)}" loading="lazy" />` : ""}
        <div class="pub-body">
          <h3 class="pub-title">
            ${
              p.url
                ? `<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">${escapeHtml(p.title)}</a>`
                : escapeHtml(p.title)
            }
          </h3>
          <div class="pub-header${p.venueLogo ? "" : " pub-header--no-logo"}">
            <div class="pub-header-main">
              <div class="pub-meta">
                ${
                  p.venue
                    ? `<span class="venue-tag ${
                        p.venueShort ? `tag-${escapeHtml(venueClass(String(p.venueShort)))}` : "tag-default"
                      }">${escapeHtml(p.venue)}</span>`
                    : ""
                }
              </div>
              <p class="pub-authors">${renderAuthors(p.authors)}</p>
            </div>
            ${
              p.venueLogo
                ? `<div class="pub-header-logo">
                     <div class="pub-logo-surface">
                     ${
                       p.venueUrl
                         ? `<a href="${escapeHtml(p.venueUrl)}" target="_blank" rel="noopener">`
                         : ""
                     }
                       <img src="${escapeHtml(p.venueLogo)}" alt="${escapeHtml(p.venue)} logo" />
                     ${p.venueUrl ? "</a>" : ""}
                     </div>
                   </div>`
                : ""
            }
          </div>
          <div class="pub-links-row">
            <div class="pub-links">
              ${renderPublicationLinks(p.resources)}
            </div>
            ${
              p.abstractHtml
                ? `<button type="button" class="pub-abstract-toggle" aria-expanded="false" aria-controls="pub-abstract-${idx}">
                     Abstract <span class="pub-abstract-arrow" aria-hidden="true">▼</span>
                   </button>`
                : ""
            }
          </div>
          ${
            p.abstractHtml
              ? `<div class="pub-abstract" id="pub-abstract-${idx}" hidden>${p.abstractHtml}</div>`
              : ""
          }
        </div>
      </article>
    `
    )
    .join("") || '<p class="content-status">No publications yet.</p>';
}

document.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;

  if (target.matches(".pager-num")) {
    newsPage = Number(target.dataset.newsPage) || 1;
    renderNews();
  }

  if (target.matches('[data-news-page="prev"]')) {
    newsPage = Math.max(1, newsPage - 1);
    renderNews();
  }

  if (target.matches('[data-news-page="next"]')) {
    const maxPage = Math.max(1, Math.ceil(NEWS.length / newsPerPage));
    newsPage = Math.min(maxPage, newsPage + 1);
    renderNews();
  }

  if (target.closest(".pub-abstract-toggle")) {
    const btn = target.closest(".pub-abstract-toggle");
    const box = document.getElementById(btn.getAttribute("aria-controls"));
    if (box) {
      const isOpen = box.hidden;
      box.hidden = !isOpen;
      btn.setAttribute("aria-expanded", String(isOpen));
      btn.classList.toggle("is-open", isOpen);
    }
    return;
  }

  if (target.matches(".tab")) {
    currentFilter = target.dataset.filter || "all";
    document.querySelectorAll(".tab").forEach((tab) => {
      const isActive = tab === target;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-pressed", String(isActive));
    });
    renderPubs();
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  setupThemeToggle();
  setupMenuNav();
  setupNewsPager();
  await Promise.all([loadNewsFromJson(), loadPubsFromJson()]);
});
