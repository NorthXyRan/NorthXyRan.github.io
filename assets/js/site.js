let NEWS = [];
let PUBS = [];
let PHOTOS = [];

let newsPage = 1;
const newsPerPage = 3;
let currentFilter = "all";

let galleryIndex = 0;
let galleryTimer = null;
const GALLERY_INTERVAL = 3000;

const THEME_KEY = "nx_theme";

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
  }

  function closeNav() {
    nav.classList.remove("is-open");
    btn.classList.remove("is-open");
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
    if (!target.closest(".mobile-nav") && !target.closest(".menu-btn") && !target.closest(".theme-btn")) {
      closeNav();
    }
  });
}

function updatePager() {
  const pager = document.querySelector(".pager");
  if (!pager) return;

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
    let start = Math.min(newsPage, Math.max(1, maxPage - 1));
    let end = Math.min(maxPage, start + 1);
    for (let i = start; i <= end; i += 1) {
      pagesHtml += `<button class="pager-num${i === newsPage ? " is-active" : ""}" data-news-page="${i}">${i}</button>`;
    }
  } else {
    for (let i = 1; i <= maxPage; i += 1) {
      pagesHtml += `<button class="pager-num${i === newsPage ? " is-active" : ""}" data-news-page="${i}">${i}</button>`;
    }
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
    const res = await fetch("/data/news.yml?v=2");
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
    const res = await fetch("/data/publications.yml?v=2");
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
          venueShort: p.conference_short || p.venue_short || "",
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
              <div class="pub-meta">
                ${
                  p.venue
                    ? `<span class="venue-tag ${
                        p.venueShort ? `tag-${p.venueShort.toLowerCase()}` : "tag-default"
                      }">${p.venue}</span>`
                    : ""
                }
              </div>
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
                <i class="fa-solid fa-file-pdf"></i>&nbsp;PDF
              </a>
              <a href="${p.video}" target="_blank" rel="noopener">
                <i class="fa-solid fa-circle-play"></i>&nbsp;VIDEO
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

async function loadPhotosFromYaml() {
  try {
    const res = await fetch("/data/photograph.yml?v=2");
    if (!res.ok) throw new Error("Failed to load photograph.yml");
    const text = await res.text();
    const parsed = window.jsyaml ? window.jsyaml.load(text) : jsyaml.load(text);
    if (Array.isArray(parsed)) {
      PHOTOS = parsed
        .map((p) => ({ src: p.src || "", alt: p.alt || "" }))
        .filter((p) => p.src);
    }
  } catch (e) {
    console.error(e);
  }
}

function setupGallery() {
  const gallery = document.querySelector(".gallery");
  const track = document.getElementById("gallery-track");
  const dotsBox = document.getElementById("gallery-dots");
  if (!gallery || !track || !dotsBox || PHOTOS.length === 0) return;

  const N = PHOTOS.length;
  const useLoop = N >= 2;
  const CLONE_COUNT = useLoop ? 2 : 0;
  const INITIAL_POS = CLONE_COUNT;

  function renderSlide(photo, realIdx, pos, isClone) {
    const eager = Math.abs(pos - INITIAL_POS) <= 2;
    return `
      <div class="gallery-slide${isClone ? " is-clone" : ""}" data-idx="${realIdx}" data-pos="${pos}" role="group" aria-label="Photo ${realIdx + 1} of ${N}" aria-hidden="true">
        <img src="${photo.src}" alt="${photo.alt}" loading="${eager ? "eager" : "lazy"}" decoding="async" draggable="false" />
      </div>
    `;
  }

  let html = "";
  if (useLoop) {
    html += renderSlide(PHOTOS[N - 2 < 0 ? 0 : N - 2], (N - 2 + N) % N, 0, true);
    html += renderSlide(PHOTOS[N - 1], N - 1, 1, true);
  }
  for (let i = 0; i < N; i++) {
    html += renderSlide(PHOTOS[i], i, i + CLONE_COUNT, false);
  }
  if (useLoop) {
    html += renderSlide(PHOTOS[0], 0, N + CLONE_COUNT, true);
    html += renderSlide(PHOTOS[1 % N], 1 % N, N + CLONE_COUNT + 1, true);
  }
  track.innerHTML = html;

  dotsBox.innerHTML = PHOTOS.map(
    (_, i) =>
      `<button type="button" class="gallery-dot${i === 0 ? " is-active" : ""}" data-idx="${i}" aria-label="Go to photo ${i + 1}"></button>`
  ).join("");

  const slides = track.querySelectorAll(".gallery-slide");
  const dots = dotsBox.querySelectorAll(".gallery-dot");
  const reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let trackPos = INITIAL_POS;

  function updateVisual() {
    slides.forEach((s) => {
      const active = Number(s.dataset.pos) === trackPos;
      s.classList.toggle("is-active", active);
      s.setAttribute("aria-hidden", active ? "false" : "true");
    });
    dots.forEach((d) => {
      d.classList.toggle("is-active", Number(d.dataset.idx) === galleryIndex);
    });
  }

  function animateTo(newPos) {
    trackPos = newPos;
    galleryIndex = useLoop ? ((newPos - CLONE_COUNT) % N + N) % N : 0;
    track.style.setProperty("--i", String(newPos));
    updateVisual();
  }

  function snapTo(pos) {
    track.style.transition = "none";
    track.style.setProperty("--i", String(pos));
    trackPos = pos;
    updateVisual();
    void track.offsetHeight;
    track.style.transition = "";
  }

  function next() {
    animateTo(trackPos + 1);
  }
  function prev() {
    animateTo(trackPos - 1);
  }

  function stopTimer() {
    if (galleryTimer) {
      window.clearInterval(galleryTimer);
      galleryTimer = null;
    }
  }

  function startTimer() {
    stopTimer();
    if (reduceMotion || N <= 1) return;
    galleryTimer = window.setInterval(next, GALLERY_INTERVAL);
  }

  track.style.setProperty("--i", String(trackPos));
  updateVisual();

  track.addEventListener("transitionend", (e) => {
    if (!useLoop) return;
    if (e.propertyName !== "transform") return;
    if (e.target !== track) return;
    if (trackPos < CLONE_COUNT) snapTo(trackPos + N);
    else if (trackPos >= N + CLONE_COUNT) snapTo(trackPos - N);
  });

  gallery.querySelector(".gallery-prev").addEventListener("click", () => {
    prev();
    startTimer();
  });
  gallery.querySelector(".gallery-next").addEventListener("click", () => {
    next();
    startTimer();
  });

  dotsBox.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement) || !t.classList.contains("gallery-dot")) return;
    const idx = Number(t.dataset.idx) || 0;
    animateTo(idx + CLONE_COUNT);
    startTimer();
  });

  track.addEventListener("click", (e) => {
    const slide = e.target instanceof HTMLElement ? e.target.closest(".gallery-slide") : null;
    if (!slide) return;
    const pos = Number(slide.dataset.pos);
    if (Number.isNaN(pos) || pos === trackPos) return;
    const diff = pos - trackPos;
    if (diff === 1) next();
    else if (diff === -1) prev();
    else animateTo(pos);
    startTimer();
  });

  gallery.addEventListener("mouseenter", stopTimer);
  gallery.addEventListener("mouseleave", startTimer);
  gallery.addEventListener("focusin", stopTimer);
  gallery.addEventListener("focusout", startTimer);

  gallery.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") {
      prev();
      startTimer();
    } else if (e.key === "ArrowRight") {
      next();
      startTimer();
    }
  });

  let touchStartX = null;
  gallery.addEventListener(
    "touchstart",
    (e) => {
      touchStartX = e.touches[0].clientX;
      stopTimer();
    },
    { passive: true }
  );
  gallery.addEventListener("touchend", (e) => {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 40) {
      if (dx < 0) next();
      else prev();
    }
    touchStartX = null;
    startTimer();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopTimer();
    else startTimer();
  });

  startTimer();
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
  setupThemeToggle();
  setupMenuNav();
  await loadNewsFromYaml();
  await loadPubsFromYaml();
  await loadPhotosFromYaml();
  newsPage = 1;
  renderNews();
  renderPubs();
  setupGallery();
});
