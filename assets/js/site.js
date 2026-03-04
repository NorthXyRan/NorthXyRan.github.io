let NEWS = [];
let PUBS = [];

let newsPage = 1;
const newsPerPage = 3;
let currentFilter = "all";

function setupMenuNav() {
  const nav = document.querySelector(".mobile-nav");
  const btn = document.querySelector(".menu-btn");
  if (!nav || !btn) return;

  function openNav() {
    nav.classList.add("is-open");
    btn.setAttribute("aria-expanded", "true");
  }

  function closeNav() {
    nav.classList.remove("is-open");
    btn.setAttribute("aria-expanded", "false");
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (nav.classList.contains("is-open")) {
      closeNav();
    } else {
      openNav();
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
    if (!target.closest(".mobile-nav") && !target.closest(".menu-btn")) {
      closeNav();
    }
  });
}

function updatePager() {
  const pager = document.querySelector(".pager");
  if (!pager) return;

  const maxPage = Math.max(1, Math.ceil(NEWS.length / newsPerPage));

  if (maxPage <= 1) {
    pager.style.display = "none";
    newsPage = 1;
    return;
  }

  pager.style.display = "flex";

  let pagesHtml = "";
  for (let i = 1; i <= maxPage; i += 1) {
    pagesHtml += `<button class="pager-num${i === newsPage ? " is-active" : ""}" data-news-page="${i}">${i}</button>`;
  }

  pager.innerHTML = `
    <button class="pager-btn" data-news-page="prev" aria-label="Previous">‹</button>
    ${pagesHtml}
    <button class="pager-btn" data-news-page="next" aria-label="Next">›</button>
  `;
}

function renderNews() {
  const start = (newsPage - 1) * newsPerPage;
  const list = NEWS.slice(start, start + newsPerPage);
  const box = document.getElementById("news-list");
  box.innerHTML = list
    .map(
      (n) => `
      <article class="news-row">
        <div class="news-date">${n.date}</div>
        <div class="news-text">${n.text}</div>
      </article>
    `
    )
    .join("");

  updatePager();
}

async function loadNewsFromYaml() {
  try {
    const res = await fetch("/data/news.yml");
    if (!res.ok) throw new Error("Failed to load news.yml");
    const text = await res.text();
    const parsed = window.jsyaml ? window.jsyaml.load(text) : jsyaml.load(text);
    if (Array.isArray(parsed)) {
      NEWS = parsed.map((n) => ({
        date: n.date ?? "",
        text: n.text ?? "",
      }));
    }
  } catch (e) {
    // Fallback: keep NEWS empty if loading fails
    console.error(e);
  }
}

async function loadPubsFromYaml() {
  try {
    const res = await fetch("/data/publications.yml");
    if (!res.ok) throw new Error("Failed to load publications.yml");
    const text = await res.text();
    const parsed = window.jsyaml ? window.jsyaml.load(text) : jsyaml.load(text);

    if (Array.isArray(parsed)) {
      PUBS = parsed.map((p) => {
        // authors: YAML 数组 -> 带粗体 / 链接的 HTML 文本
        let authorsHtml = "";
        if (Array.isArray(p.authors) && p.authors.length > 0) {
          authorsHtml = p.authors
            .map((a) => {
              let name = a.name || "";
              if (!name) return "";

              let inner = name;
              if (a.url) {
                inner = `<a href="${a.url}" target="_blank" rel="noopener">${inner}</a>`;
              }
              if (a.emphasis) {
                inner = `<strong>${inner}</strong>`;
              }
              return inner;
            })
            .filter(Boolean)
            .join(", ");
        }

        // 从 keywords 生成用于过滤的标签（如 'education', 'hci'）
        let keywordTags = [];
        if (typeof p.keywords === "string" && p.keywords.trim().length > 0) {
          keywordTags = p.keywords
            .split(",")
            .map((k) =>
              String(k)
                .trim()
                .toLowerCase()
                .replace(/\s+/g, "-")
            )
            .filter(Boolean);
        }

        const baseTags = ["all"];
        const mergedTags = Array.from(new Set([...baseTags, ...keywordTags]));

        return {
          title: p.title || "",
          venue: p.conference || p.venue || "",
          authors: authorsHtml,
          image: p.image || "",
          pdf: p.pdf || p.href || "",
          video: p.video || "",
          url: p.url || "",
          abstract: p.abstract || "",
          conferenceLogo: p.conference_logo || "",
          conferenceUrl: p.conference_url || "",
          tags: mergedTags,
        };
      });
    }
  } catch (e) {
    console.error(e);
  }
}

function renderPubs() {
  const data = PUBS.filter((p) => p.tags.includes(currentFilter));
  const box = document.getElementById("pub-list");
  box.innerHTML = data
    .map(
      (p, idx) => `
      <article class="pub-card">
        <img src="${p.image}" alt="${p.title}" />
        <div class="pub-body">
          <h3 class="pub-title">
            ${
              p.url
                ? `<a href="${p.url}" target="_blank" rel="noopener">${p.title}</a>`
                : p.title
            }
          </h3>
          <div class="pub-header">
            <div class="pub-header-main">
              <p class="pub-meta"><em>${p.venue}</em></p>
              <p class="pub-authors">${p.authors}</p>
            </div>
            ${
              p.conferenceLogo
                ? `<div class="pub-header-logo">
                     ${
                       p.conferenceUrl
                         ? `<a href="${p.conferenceUrl}" target="_blank" rel="noopener">`
                         : ""
                     }
                       <img src="${p.conferenceLogo}" alt="${p.venue} logo" />
                     ${p.conferenceUrl ? "</a>" : ""}
                   </div>`
                : ""
            }
          </div>
          <div class="pub-links-row">
            <div class="pub-links">
              <a href="${p.pdf}" target="_blank" rel="noopener">
                <i class="fa-solid fa-file-pdf"></i>&nbsp;pdf
              </a>
              <a href="${p.video}" target="_blank" rel="noopener">
                <i class="fa-solid fa-circle-play"></i>&nbsp;video
              </a>
            </div>
            ${
              p.abstract
                ? `<button type="button" class="pub-abstract-toggle" data-idx="${idx}">
                     Abstract <span class="pub-abstract-arrow">▼</span>
                   </button>`
                : ""
            }
          </div>
          ${
            p.abstract
              ? `<div class="pub-abstract" data-idx="${idx}">${p.abstract}</div>`
              : ""
          }
        </div>
      </article>
    `
    )
    .join("");
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
    const idx = btn.dataset.idx;
    const box = document.querySelector(`.pub-abstract[data-idx="${idx}"]`);
    if (box) {
      const isOpen = box.classList.toggle("is-open");
      btn.classList.toggle("is-open", isOpen);
    }
    return;
  }

  if (target.matches(".tab")) {
    currentFilter = target.dataset.filter || "all";
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("is-active"));
    target.classList.add("is-active");
    renderPubs();
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  setupMenuNav();
  await loadNewsFromYaml();
  await loadPubsFromYaml();
  newsPage = 1;
  renderNews();
  renderPubs();
});
