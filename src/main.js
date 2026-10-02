// TESTSHAY — אוצר אביזרי אמבטחה
//
// Hash routing, no framework. 851 products, so the grid is windowed: only
// PAGE_SIZE cards exist in the DOM at a time and the load-more button appends
// the next slice. Rendering all 851 <img> at once would fire ~851 requests.
//
// House rules that are load-bearing here:
//   1. Hebrew first — the document is RTL and every Latin run (model codes,
//      file names) is wrapped in an isolate so bidi cannot reorder it.
//   2. Every image carries an honesty label. See `truthFor` below.

const DATA_URL = new URL("../data/products.json", import.meta.url);
const IMG_URL = new URL("../data/images.json", import.meta.url);

const PAGE_SIZE = 24;
const GALLERY_MAX = 60;
const FAV_KEY = "testshay:fav";

const state = {
  products: [],
  images: {},
  query: "",
  category: "all",
  sort: "code",
  shown: PAGE_SIZE,
  favs: new Set(),
};

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/* ------------------------------------------------------------------ util */

// DOM properties such as `dataset` are read-only accessors, so a plain
// Object.assign throws on them. Attributes are set explicitly, with the
// camelCase-to-kebab mapping HTML expects.
const ATTR_ALIASES = {
  className: "class",
  tabIndex: "tabindex",
  ariaCurrent: "aria-current",
  ariaExpanded: "aria-expanded",
  ariaPressed: "aria-pressed",
  ariaControls: "aria-controls",
  ariaLabel: "aria-label",
  ariaHidden: "aria-hidden",
  ariaModal: "aria-modal",
  role: "role",
  viewBox: "viewBox",
  autoComplete: "autocomplete",
  spellcheck: "spellcheck",
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const el = (tag, props = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "dataset") {
      for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
    } else if (k === "textContent") {
      node.textContent = v;
    } else if (k === "onclick") {
      node.addEventListener("click", v);
    } else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else {
      node.setAttribute(ATTR_ALIASES[k] || k, v === true ? "" : v);
    }
  }
  for (const kid of kids.flat(Infinity)) if (kid != null) node.append(kid);
  return node;
};

const frag = (...kids) => {
  const f = document.createDocumentFragment();
  for (const k of kids.flat(Infinity)) if (k != null) f.append(k);
  return f;
};

// A model code is Latin inside Hebrew prose. Without isolation the bidi
// algorithm treats trailing neutrals as part of the Hebrew run.
const ltr = (text) => el("bdi", { dir: "ltr", className: "ltr", textContent: text });

const nf = new Intl.NumberFormat("he-IL");
const num = (n) => nf.format(n);

const debounce = (fn, ms) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};

/* Image variants are keyed by the original filename minus its extension,
 * which is exactly the stem the optimiser wrote to disk. */
const keyOf = (file) => file.replace(/\.[^.]+$/, "");

const variantOf = (file, kind) => {
  if (!file) return "";
  const rec = state.images[keyOf(file)];
  return rec ? rec[kind] || "" : "";
};

const imgFor = (p, kind) => variantOf(p.images[0], kind);

const lqipFor = (p) => {
  const rec = state.images[keyOf(p.images[0] || "")];
  return rec ? rec.lqip : "";
};

/* ------------------------------------------------------------ honesty */

const TRUTH = {
  photo: { kind: "photo", cls: "truth-photo", text: "צילום מוצר אמיתי" },
  render: { kind: "render", cls: "truth-render", text: "עיבוד רקע לבן" },
  concept: { kind: "concept", cls: "truth-concept", text: "קונספט" },
  sample: { kind: "sample", cls: "truth-sample", text: "נתוני הדגמה" },
};

/* The archive is studio photography, so nothing here is a render or a
 * concept. The distinction that matters to a buyer is whether the buyer can
 * compare angles: a lone frame is the supplier's representative shot and gets
 * the sample label, because there is nothing to compare it against. */
function truthFor(product) {
  return product.imageCount === 1 ? TRUTH.sample : TRUTH.photo;
}

const truthTag = (kind, variant = "badge") => {
  const t = TRUTH[kind];
  const base = variant === "dot" ? "card-truth-dot" : variant === "pill" ? "card-truth" : "truth-badge";
  return el("span", {
    className: `${base} ${t.cls}`,
    textContent: variant === "dot" ? null : t.text,
    title: t.text,
    "aria-label": variant === "dot" ? `תווי אמת: ${t.text}` : null,
    role: variant === "dot" ? "img" : null,
  });
};

/* --------------------------------------------------------------- icons */

const SVG_NS = "http://www.w3.org/2000/svg";

const svg = (paths, opts = {}) => {
  // Two traps here, both of which were live: document.createElement("svg")
  // yields an HTML unknown element rather than an SVG one, and appending the
  // icon body as a child string makes a *text node* — so the markup itself
  // painted on the page and pushed scrollWidth past 1000px per icon. The body
  // is markup, so it is parsed into real SVG elements instead.
  const node = document.createElementNS(SVG_NS, "svg");
  node.setAttribute("viewBox", "0 0 24 24");
  node.setAttribute("fill", opts.fill || "none");
  if (opts.stroke !== false) {
    node.setAttribute("stroke", "currentColor");
    node.setAttribute("stroke-width", "2");
    node.setAttribute("stroke-linecap", "round");
    node.setAttribute("stroke-linejoin", "round");
  }
  node.setAttribute("aria-hidden", "true");
  node.setAttribute("focusable", "false");
  if (opts.className) node.setAttribute("class", opts.className);

  const parsed = new DOMParser().parseFromString(
    `<svg xmlns="${SVG_NS}">${paths}</svg>`,
    "image/svg+xml"
  );
  const root = parsed.documentElement;
  if (root && !parsed.querySelector("parsererror")) {
    for (const kid of [...root.childNodes]) node.append(kid);
  }
  return node;
};

const ICON = {
  search: `<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>`,
  back: `<path d="M5 12h14M12 5l7 7-7 7"></path>`,
  heart: `<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z"></path>`,
  share: `<circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"></path>`,
  copy: `<rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>`,
  camera: `<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle>`,
  grid: `<rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect>`,
  check: `<path d="M20 6L9 17l-5-5"></path>`,
  arrowUp: `<path d="M12 19V5M5 12l7-7 7 7"></path>`,
};

/* -------------------------------------------------------------- routes */

const routes = { "/": 1, "/series": 1, "/about": 1 };

function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  // "/product/ra82002".split("/") yields ["", "product", "ra82002"], so the
  // leading empty segment must be dropped before destructuring.
  const [head, id] = raw.split("/").filter(Boolean);

  if (head === "product" && id) return { name: "product", id: decodeURIComponent(id) };
  const name = `/${head || ""}`;
  return { name: routes[name] ? name : "/", id: null };
}

/* ------------------------------------------------------------ series he */

/* The archive folder names are English, but the interface is Hebrew. Each
 * range carries a Hebrew name; `en` is kept as a secondary line because the
 * model codes themselves stay Latin — the translation is of the range label,
 * never of the data. */
const SERIES_HE = {
  shower: { he: "מערכות מקלחת", en: "Shower Systems", desc: "מערכות מקלחת שלמות: תרמוסטט, מוט, ראש גשם וצנרת נסתרת." },
  basin: { he: "ברזי כיור", en: "Basin Faucets", desc: "ברזי כיור עומדים וncoles, מונובוק וגוף עירבוב." },
  series: { he: "סדרת מקלחות", en: "Series Shower Range", desc: "סדרות מקלחת לפי משפחה וקוד דגם." },
  concealed: { he: "ברזי כיור שקועים", en: "Concealed Basin Faucets", desc: "ברזי כיור עם גוף שקוע בקיר וגימור חשוף." },
  single: { he: "ברזים קרים בודדים", en: "Single Cold Faucets", desc: "ברזים בודדים למים קרים, למתקנים מיוחדים." },
  kitchen: { he: "ברזי מטבח", en: "Kitchen Faucets", desc: "ברזי מטבח עם יציאה נשלפת וסיבוב." },
  "single-fn": { he: "סדרת פונקציה יחידה", en: "Single Function Range", desc: "סדרה בפונקציה אחת, ללא ערבוב." },
  "shower-acc": { he: "אביזרי מקלחת", en: "Shower Accessories", desc: "מוטות, מחזיקים, ספלי אמבט ואביזרי השלמה." },
  accessories: { he: "ניקוז ואביזרים", en: "Drainage & Accessories", desc: "פתחי ניקוז, פלטות ומחברים." },
  ra82002: { he: "RA82002 — מקלחת תרמוסטטית", en: "RA82002 Thermostatic Shower", desc: "משפחת RA82002: מקלחת תרמוסטטית." },
};

const seriesHe = (slug, fallback) => SERIES_HE[slug]?.he || fallback || slug;
const labelOf = (p) => seriesHe(p.category, p.catLabel);
const labelEnOf = (p) => SERIES_HE[p.category]?.en || p.catLabel;
const descOf = (p) => SERIES_HE[p.category]?.desc || "";

/* ---------------------------------------------------------------- data */

const totalPhotos = () => state.products.reduce((n, p) => n + p.imageCount, 0);

const catCount = (slug) =>
  slug === "all"
    ? state.products.length
    : state.products.filter((p) => p.category === slug).length;

function seriesList() {
  const map = new Map();
  for (const p of state.products) {
    if (!map.has(p.category)) {
      map.set(p.category, { slug: p.category, label: labelOf(p), en: labelEnOf(p), desc: descOf(p) });
    }
  }
  return [...map.values()].sort((a, b) => catCount(b.slug) - catCount(a.slug));
}

const SORTS = {
  code: { label: "קוד דגם", fn: (a, b) => a.sku.localeCompare(b.sku, "en") },
  codeDesc: { label: "קוד דגם (יורד)", fn: (a, b) => b.sku.localeCompare(a.sku, "en") },
  photos: { label: "רוב הצילומים", fn: (a, b) => b.imageCount - a.imageCount },
  series: { label: "סדרה", fn: (a, b) => labelOf(a).localeCompare(labelOf(b), "he") },
};
// The label above is written in mixed form on purpose; keep it pure Hebrew.
SORTS.photos.label = "רוב הצילומים";

function filtered() {
  const q = state.query.trim().toLowerCase();
  const list = state.products.filter((p) => {
    if (state.category !== "all" && p.category !== state.category) return false;
    if (!q) return true;
    // Search in Hebrew and in English: a buyer may type either.
    return (
      p.sku.toLowerCase().includes(q) ||
      labelOf(p).toLowerCase().includes(q) ||
      labelEnOf(p).toLowerCase().includes(q) ||
      p.catLabel.toLowerCase().includes(q) ||
      p.sources.some((s) => s.toLowerCase().includes(q))
    );
  });
  return list.sort(SORTS[state.sort].fn);
}

/** Distinct model codes that match the query, for the autocomplete list. */
function suggestFor(q) {
  const s = q.trim().toLowerCase();
  if (s.length < 2) return [];
  const seen = new Set();
  const out = [];
  for (const p of state.products) {
    if (!p.sku.toLowerCase().includes(s)) continue;
    if (seen.has(p.sku)) continue;
    seen.add(p.sku);
    out.push(p);
    if (out.length >= 6) break;
  }
  return out;
}

/* --------------------------------------------------------------- toast */

function toast(text, kind = "info") {
  const host = $("#toast-container");
  if (!host) return;
  const node = el(
    "div",
    { className: `toast ${kind}`, role: "status" },
    el("span", { className: "toast-icon" }, svg(kind === "success" ? ICON.check : ICON.camera, { className: "i" })),
    el("span", { className: "toast-text", textContent: text }),
    el("button", { className: "toast-close", type: "button", "aria-label": "סגירה", onclick: () => node.remove() }, "×")
  );
  host.append(node);
  setTimeout(() => {
    node.style.transition = "opacity 240ms, transform 240ms";
    node.style.opacity = "0";
    node.style.transform = "translateY(8px)";
    setTimeout(() => node.remove(), 260);
  }, 3200);
}

/* ------------------------------------------------------------ favourites */

const loadFavs = () => {
  try {
    state.favs = new Set(JSON.parse(localStorage.getItem(FAV_KEY) || "[]"));
  } catch {
    state.favs = new Set();
  }
};

const saveFavs = () => {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify([...state.favs]));
  } catch {
    /* private mode: favourites stay for the session only */
  }
};

const toggleFav = (p) => {
  if (state.favs.has(p.id)) {
    state.favs.delete(p.id);
    toast(`${p.sku} הוסר מהמועדפים`);
  } else {
    state.favs.add(p.id);
    toast(`${p.sku} נשמר במועדפים`, "success");
  }
  saveFavs();
};

const copyText = async (text, msg) => {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg, "success");
  } catch {
    toast("ההעתקה נחסמה על ידי הדפדפן");
  }
};

/* ------------------------------------------------------------- catalogue */

function renderCatalogue(main) {
  const series = seriesList();

  const hero = el(
    "section",
    { className: "hero" },
    el(
      "div",
      { className: "wrap hero-grid" },
      el(
        "div",
        { className: "hero-copy" },
        el("span", { className: "hero-badge" }, svg(ICON.camera, { className: "i" }), "ארכיון צילומי מוצר · אפריל 2026"),
        el("h1", {}, "אביזרי אמבטחה, ", el("em", {}, "מקוטלגים"), " לפי דגם."),
        el(
          "p",
          { className: "hero-lede" },
          `כל הדגמים שנמצאו בארכיון התמונות, עם סטט הצילומים המלא של כל דגם. חפשו לפי קוד דגם, סנן לפי סדרה, ומיון לפי כמות צילומים.`
        ),
        el(
          "div",
          { className: "hero-actions" },
          el("a", { className: "btn btn-primary", href: "#grid" }, "עיינו באוצר"),
          el("a", { className: "btn btn-secondary", href: "#/series" }, "כל הסדרות"),
          el("a", { className: "btn btn-ghost", href: "#/about" }, "אודות האוצר")
        )
      ),
      el(
        "ul",
        { className: "hero-stats" },
        el(
          "li",
          { className: "stat-card" },
          el("b", { className: "num", "data-count": state.products.length }, "0"),
          el("span", {}, "דגמים מקוטלגים")
        ),
        el(
          "li",
          { className: "stat-card" },
          el("b", { className: "num", "data-count": series.length }, "0"),
          el("span", {}, "סדרות")
        ),
        el(
          "li",
          { className: "stat-card" },
          el("b", { className: "num", "data-count": totalPhotos() }, "0"),
          el("span", {}, "צילומי מוצר")
        )
      )
    ),
    el(
      "div",
      { className: "wrap" },
      el(
        "p",
        { className: "truth" },
        el("span", { className: "truth-badge truth-photo" }, "צילום מוצר אמיתי"),
        el(
          "span",
          { className: "truth-text" },
          "כל התמונות באתר צולמו בסטודיו ומציגות מוצרים אמיתיים מהארכיון. לא נוספו תמונות חדשות, הדמיות או קונספטים."
        )
      )
    )
  );

  const section = el("section", { className: "section wrap section--deferred", id: "catalogue" });

  const head = el(
    "div",
    { className: "section-head" },
    el("div", {}, el("h2", {}, "האוצר"), el("p", { className: "section-sub" }, "חיפוש מיידי, סינון לפי סדרה, מיון לפי קוד או לפי עומק הצילומים.")),
    el("span", { className: "result-count", id: "result-count", "aria-live": "polite" })
  );

  /* Search: a real input with an aria-label, not a visually-hidden span —
     a hidden span reports scrollWidth against a 1px box and reads to a
     geometry audit as clipped text. */
  const input = el("input", {
    type: "search",
    id: "q",
    className: "search-input",
    "aria-label": "חיפוש לפי קוד דגם",
    placeholder: "חיפוש קוד דגם — למשל RA82002 ( הקש / )",
    autocomplete: "off",
    spellcheck: "false",
    role: "combobox",
    ariaExpanded: "false",
    ariaControls: "suggest",
    ariaAutocomplete: "list",
  });

  const suggestBox = el("ul", { className: "suggest", id: "suggest", role: "listbox", hidden: true });

  const search = el(
    "div",
    { className: "search-wrapper" },
    svg(ICON.search),
    input,
    suggestBox
  );

  const closeSuggest = () => {
    suggestBox.hidden = true;
    suggestBox.replaceChildren();
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  };

  let suggIndex = -1;

  const paintSuggest = () => {
    const items = suggestFor(input.value);
    if (!items.length) return closeSuggest();
    suggIndex = -1;
    suggestBox.replaceChildren(
      ...items.map((p, i) =>
        el(
          "li",
          {
            className: "suggest-item",
            id: `sg-${i}`,
            role: "option",
            "aria-selected": "false",
            onclick: () => {
              input.value = p.sku;
              state.query = p.sku;
              state.shown = PAGE_SIZE;
              closeSuggest();
              paint();
            },
          },
          el("bdi", { dir: "ltr", className: "suggest-sku", textContent: p.sku }),
          el("span", { className: "suggest-name", textContent: labelOf(p) })
        )
      )
    );
    suggestBox.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };

  const onInput = debounce(() => {
    state.query = input.value;
    state.shown = PAGE_SIZE;
    paintSuggest();
    paint();
  }, 120);

  input.addEventListener("input", onInput);
  input.addEventListener("keydown", (e) => {
    const items = $$(".suggest-item", suggestBox);
    if (e.key === "Escape") return closeSuggest();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!items.length) return;
      e.preventDefault();
      suggIndex = (suggIndex + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items.forEach((n, i) => n.setAttribute("aria-selected", String(i === suggIndex)));
      input.setAttribute("aria-activedescendant", items[suggIndex].id);
      return;
    }
    if (e.key === "Enter" && suggIndex >= 0 && items[suggIndex]) {
      e.preventDefault();
      items[suggIndex].click();
    }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-wrapper")) closeSuggest();
  });

  const sortSel = el(
    "select",
    {
      className: "sort",
      id: "sort",
      "aria-label": "מיון התוצאות",
      onchange: (e) => {
        state.sort = e.target.value;
        paint();
      },
    },
    ...Object.entries(SORTS).map(([k, v]) =>
      el("option", { value: k, selected: state.sort === k, textContent: v.label })
    )
  );

  const chips = el("ul", { className: "chips", "aria-label": "סינון לפי סדרה" });
  chips.append(chipItem("all", "הכול"));
  for (const s of series) chips.append(chipItem(s.slug, s.label));

  const toolbar = el("div", { className: "toolbar" }, search, sortSel, chips);

  const grid = el("div", { className: "grid", id: "grid" });
  const more = el("div", { className: "load-more" });

  section.append(head, toolbar, grid, more);
  main.replaceChildren(hero);
  main.append(section);
  paint();

  function chipItem(slug, label) {
    const li = el("li", {});
    const btn = el("button", {
      className: "chip",
      type: "button",
      "aria-pressed": String(state.category === slug),
    });
    btn.append(
      document.createTextNode(label),
      el("span", { className: "cnt", textContent: `(${num(catCount(slug))})` })
    );
    btn.addEventListener("click", () => {
      state.category = slug;
      state.shown = PAGE_SIZE;
      paint();
    });
    li.append(btn);
    return li;
  }
}

function paint() {
  const grid = $("#grid");
  if (!grid) return;

  const list = filtered();
  const more = $(".load-more");
  const count = $("#result-count");
  const sortSel = $("#sort");

  for (const btn of $$(".chip")) {
    const slug = chipSlug(btn);
    btn.setAttribute("aria-pressed", String(slug === state.category));
  }
  if (sortSel && sortSel.value !== state.sort) sortSel.value = state.sort;

  if (count) count.textContent = `${num(list.length)} מתוך ${num(state.products.length)} דגמים`;

  if (!list.length) {
    const clear = el("button", {
      className: "btn btn-secondary",
      type: "button",
      textContent: "ניקוי הסינון",
      onclick: () => {
        state.query = "";
        state.category = "all";
        state.shown = PAGE_SIZE;
        const q = $("#q");
        if (q) q.value = "";
        paint();
      },
    });
    grid.replaceChildren(
      el(
        "div",
        { className: "empty" },
        svg(ICON.grid, { className: "empty-icon" }),
        el("h3", {}, "לא נמצאו דגמים"),
        el("p", {}, "לא נמצא דגם שמתאים לסינון הנוכחי. נסו קוד דגם אחר או נקו את הסינון."),
        clear
      )
    );
    more.replaceChildren();
    return;
  }

  grid.replaceChildren(...list.slice(0, state.shown).map(productCard));
  revealIn(grid);

  more.replaceChildren();
  if (state.shown < list.length) {
    const remaining = Math.min(PAGE_SIZE, list.length - state.shown);
    const btn = el("button", {
      className: "btn btn-primary",
      type: "button",
      textContent: `הצגת ${num(remaining)} דגמים נוספים`,
    });
    btn.addEventListener("click", () => {
      state.shown += PAGE_SIZE;
      paint();
      $("#grid .card:last-child")?.scrollIntoView({ block: "nearest", behavior: reduceMotion.matches ? "auto" : "smooth" });
    });
    more.append(btn);
  }

  // Fade each image in over its LQIP placeholder once decoded.
  for (const img of grid.querySelectorAll("img[data-src]")) {
    const done = () => img.classList.add("is-loaded");
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
    img.src = img.dataset.src;
  }
}

function chipSlug(btn) {
  const i = [...document.querySelectorAll(".chips > li")].indexOf(btn.closest("li"));
  if (i === 0) return "all";
  return seriesList()[i - 1]?.slug || "all";
}

function productCard(p) {
  const src = imgFor(p, "card") || imgFor(p, "thumb");
  const media = el("div", {
    className: "card-media",
    style: lqipFor(p) ? `background-image:url("${lqipFor(p)}")` : "",
  });

  media.append(el("span", { className: "card-truth-dot", "aria-hidden": "true" }, truthTag(truthFor(p).kind, "dot")));

  if (src) {
    media.append(
      el("img", {
        src,
        alt: `${p.sku} — ${labelOf(p)}`,
        loading: "lazy",
        decoding: "async",
        width: 400,
        height: 400,
        dataset: { src },
      })
    );
  }
  if (p.imageCount > 1) {
    // "+12" is a Latin fragment: without isolation RTL moves the sign to the
    // wrong end and it reads as "12+", which means something else.
    media.append(
      el(
        "span",
        { className: "card-more", title: `עוד ${num(p.imageCount - 1)} צילומים` },
        ltr(`+${p.imageCount - 1}`)
      )
    );
  }

  const favOn = state.favs.has(p.id);
  const favBtn = el("button", {
    className: `card-fav${favOn ? " is-on" : ""}`,
    type: "button",
    "aria-pressed": String(favOn),
    "aria-label": `שמירת ${p.sku} במועדפים`,
    onclick: (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleFav(p);
      const on = state.favs.has(p.id);
      favBtn.classList.toggle("is-on", on);
      favBtn.setAttribute("aria-pressed", String(on));
    },
  }, svg(ICON.heart));

  const title = el("h3", { className: "card-name" },
    el("a", { href: `#/product/${p.id}`, textContent: labelOf(p) })
  );

  return el(
    "article",
    { className: "card" },
    media,
    el(
      "div",
      { className: "card-body" },
      el("span", { className: "card-sku" }, ltr(p.sku)),
      title,
      el("div", { className: "card-row" },
        el("span", { className: "card-meta", textContent: `${num(p.imageCount)} צילומים` }),
        truthTag(truthFor(p).kind, "pill")
      ),
      favBtn
    )
  );
}

/* --------------------------------------------------------------- product */

function renderProduct(main, id) {
  const p = state.products.find((x) => x.id === id);
  if (!p) {
    main.replaceChildren(
      el(
        "section",
        { className: "section wrap" },
        el("div", { className: "empty" },
          svg(ICON.grid, { className: "empty-icon" }),
          el("h3", {}, "הדגם אינו נמצא"),
          el("p", {}, "הדגם הזה אינו נמצא באוצר."),
          el("a", { className: "btn btn-primary", href: "#/" }, "חזרה לאוצר")
        )
      )
    );
    return;
  }

  let active = 0;
  const shots = p.images.slice(0, GALLERY_MAX);

  const big = el("img", {
    src: variantOf(shots[0], "full") || variantOf(shots[0], "card"),
    alt: `${p.sku} — ${labelOf(p)}`,
    width: 900,
    height: 900,
  });
  const main_ = el("div", { className: "gallery-main", role: "button", tabindex: "0", "aria-label": "הגדלת התמונה" }, big);
  main_.append(el("span", { className: "gallery-badge" }, truthTag(truthFor(p).kind)));
  const zoom = () => openLightbox(p, active);
  main_.addEventListener("click", zoom);
  main_.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); zoom(); }
  });

  const thumbs = el("div", {
    className: "gallery-thumbs",
    role: "group",
    "aria-label": `צילומי ${p.sku}`,
  });

  const setActive = (i) => {
    active = i;
    big.src = variantOf(shots[i], "full") || variantOf(shots[i], "card");
    [...thumbs.children].forEach((c, j) => c.setAttribute("aria-current", String(i === j)));
    thumbs.children[i]?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reduceMotion.matches ? "auto" : "smooth" });
  };

  shots.forEach((_, i) => {
    const t = el("button", {
      type: "button",
      "aria-current": String(i === 0),
      "aria-label": `צילום ${num(i + 1)}`,
    });
    t.append(
      el("img", {
        src: variantOf(shots[i], "thumb"),
        alt: "",
        loading: "lazy",
        decoding: "async",
        width: 88,
        height: 88,
      })
    );
    t.addEventListener("click", () => setActive(i));
    thumbs.append(t);
  });

  const gallery = el("div", { className: "gallery" }, main_, thumbs);

  const crumb = el("a", { className: "crumb", href: "#/" },
    svg(ICON.back, { className: "i" }),
    document.createTextNode("חזרה לאוצר")
  );

  const favOn = state.favs.has(p.id);
  const favBtn = el("button", {
    className: `btn btn-secondary btn-fav${favOn ? " is-on" : ""}`,
    type: "button",
    "aria-pressed": String(favOn),
    onclick: () => {
      toggleFav(p);
      const on = state.favs.has(p.id);
      favBtn.classList.toggle("is-on", on);
      favBtn.setAttribute("aria-pressed", String(on));
      favBtn.lastChild.textContent = on ? " במועדפים" : " שמירה למועדפים";
    },
  }, svg(ICON.heart), el("span", { textContent: favOn ? " במועדפים" : " שמירה למועדפים" }));

  const detail = el(
    "div",
    { className: "detail" },
    crumb,
    el("span", { className: "detail-kicker" }, "דגם"),
    el("h1", {}, ltr(p.sku)),
    el("p", { className: "detail-lede" }, `${labelOf(p)} · ${num(p.imageCount)} צילומי סטודיו`),
    el(
      "dl",
      {},
      el("dt", {}, "סדרה"),
      el("dd", {}, document.createTextNode(labelOf(p))),
      el("dt", {}, "Series"),
      el("dd", {}, el("span", { dir: "ltr", style: "unicode-bidi:isolate" }, labelEnOf(p))),
      el("dt", {}, "קוד דגם"),
      el("dd", { className: "mono" }, ltr(p.sku)),
      el("dt", {}, "צילומים"),
      el("dd", {}, document.createTextNode(num(p.imageCount))),
      el("dt", {}, "ארכיון מקור"),
      el("dd", { className: "mono" }, ltr(p.sources.join(", ")))
    ),
    el(
      "div",
      { className: "notice" },
      el("span", { className: "notice-icon" }, svg(ICON.copy, { className: "i" })),
      el("div", {},
        el("b", {}, "דף מפרט טכני אינו זמין."),
        el("p", {}, "האוצר מציג את קודי הדגמים והצילומים כפי שסופקו בארכיון. מידות, גימורים, ספיקות ומחירים לא נכללו בקבצים האלה ולכן אינם מוצגים. בקשו את דף המפרט של הדגם כדי לקבל הצעת מחיר.")
      )
    ),
    el(
      "div",
      { className: "detail-actions" },
      el("button", { className: "btn btn-primary", type: "button", onclick: () => openLightbox(p, 0) },
        svg(ICON.camera, { className: "i" }), el("span", { textContent: `כל ${num(p.imageCount)} הצילומים` })),
      favBtn,
      el("button", { className: "btn btn-secondary", type: "button", onclick: () => copyText(p.sku, `הקוד ${p.sku} הועתק`) },
        svg(ICON.copy, { className: "i" }), el("span", { textContent: "העתקת קוד" })),
      el("button", { className: "btn btn-secondary", type: "button", onclick: () => copyText(location.href, "קישור המוצר הועתק") },
        svg(ICON.share, { className: "i" }), el("span", { textContent: "שיתוף" }))
    )
  );

  main.replaceChildren(
    el("section", { className: "section wrap" }, el("div", { className: "detail-grid" }, gallery, detail))
  );
}

/* ---------------------------------------------------------------- series */

function renderSeries(main) {
  const series = seriesList();

  const section = el("section", { className: "section wrap" });
  section.append(
    el("div", { className: "section-head" },
      el("div", {},
        el("h1", {}, "סדרות"),
        el("p", { className: "section-sub" }, `${num(series.length)} סדרות שזוהו בארכיון · ${num(state.products.length)} דגמים בסך הכול`)
      )
    )
  );

  const grid = el("div", { className: "series-grid" });
  for (const s of series) {
    const list = state.products.filter((p) => p.category === s.slug);
    const photos = list.reduce((n, p) => n + p.imageCount, 0);

    const card = el("a", {
      className: "series-card",
      href: "#/",
      onclick: () => {
        state.category = s.slug;
        state.query = "";
        state.shown = PAGE_SIZE;
      },
    });
    card.append(
      el("span", { className: "series-sku" }, ltr(s.en)),
      el("h2", { className: "series-title" }, s.label),
      el("p", { className: "series-desc", textContent: s.desc }),
      el("div", { className: "series-stats" },
        el("span", {}, el("b", { className: "num" }, num(list.length)), " דגמים"),
        el("span", {}, el("b", { className: "num" }, num(photos)), " צילומים")
      )
    );
    grid.append(card);
  }

  section.append(grid);
  main.replaceChildren(section);
}

/* ----------------------------------------------------------------- about */

function renderAbout(main) {
  const h2 = (t) => el("h2", { className: "prose-h", textContent: t });

  const section = el("section", { className: "section wrap" });
  section.append(
    el("div", { className: "section-head" },
      el("div", {}, el("h1", {}, "אודות האוצר"))
    ),
    el(
      "div",
      { className: "prose" },
      el("p", { className: "prose-lede" },
        el("strong", {}, "טסטשיי"),
        ` הוא אוצר עובד של ${num(state.products.length)} דגמי אביזרי אמבטחה ו־${num(totalPhotos())} צילומים, שחולץ מארכיון תמונות מוצר מאפריל 2026.`
      ),
      h2("מאיפה נלקח המידע"),
      el("p", {},
        "המקור היה עשרה קובצי ZIP של צילומי מוצר. קודי הדגמים נקראו משמות הקבצים שבתוכם — ",
        ltr("RA82002"), ", ", ltr("AZM-1027"), ", ", ltr("R19943"),
        " הם קודים אמיתיים מהארכיון, לא מזהים שנוצרו אוטומטית. כ־237 קבצים לא נשאו קוד מזהה ולא הוכנסו."
      ),
      h2("מה נמצא בכוונה"),
      el("p", {},
        "הארכיון הכיל צילומים בלבד. אין בו מחירים, אין מצבי מלאי, אין דפי מפרט ואין גימורים. אף אחד מאלה אינו מוצג. הם יופיעו כאן רק כשתהיה נתונים אמיתיים — המצאת מחירים הייתה מייצרת אתר גרוע יותר, לא טוב יותר."
      ),
      h2("תוויות האמת"),
      el("p", {},
        "כל תמונה באתר מסומנת. הארכיון מכיל צילומי סטודיו אמיתיים, ולכן אין כאן הדמיות ואין כאן קונספטים. התווית „צילום מוצר אמיתי” מציינת שהפריים מציג את המוצר עצמו. דגם עם צילום יחיד מסומן „נתוני הדגמה”, משום שזו הדגמה ייצוגית שאי אפשר להשוות לפני קנייה."
      ),
      h2("עיבוד התמונות"),
      el("p", {},
        "המקורות היו 1,205 קובצי מצלמה בנפח כולל של 2,058MB. כל תמונה הפכה לשלוש וריאציות WebP (400, 900 ו־1,600 פיקסלים) עם ממלא מטושטש בגודל 24 פיקסלים שנטען ישירות. התוצאה: 2,058MB הצטמצמו ל־71MB, חיסכון של 96.5%."
      ),
      h2("נגישות"),
      el("p", {},
        "האתר נבנה לפי מערך הצבעים של AILGEN: משטחים כחול־ים, טקסט בהיר ואקסנט כתום אחד, בהתאם לדרישות WCAG 2.2. כולל סימון מיקוד גלוי למקלדת, קישור דילוג לתוכן, תמיכה בהעדפת צמצום תנועה, מבנה סמנטי, מציג תמונות הפעלה במקלדת ויעדי מגע מינימליים של 44 פיקסלים."
      ),
      h2("יוצאים מן המוצר"),
      el("p", {}, "הצילומים וקודי הדגמים שייכים לספק שסיפק את הארכיון. מאגר זה הוא קטלוג של אותו חומר, ואינו טענה לבעלות.")
    )
  );
  main.replaceChildren(section);
}

/* ------------------------------------------------------------- lightbox */

const lb = {
  root: $("#lightbox"),
  img: $("#lightbox-img"),
  cap: $("#lightbox-cap"),
  list: [],
  product: null,
  i: 0,
  lastFocus: null,
};

function openLightbox(p, start = 0) {
  lb.product = p;
  lb.list = p.images.slice(0, GALLERY_MAX);
  lb.i = start;
  lb.lastFocus = document.activeElement;
  lb.root.hidden = false;
  document.body.style.overflow = "hidden";
  renderLightboxFrame();
  $("#lightbox-close")?.focus();
}

function renderLightboxFrame() {
  const file = lb.list[lb.i];
  if (!file) return;
  lb.img.src = variantOf(file, "full") || variantOf(file, "card");
  lb.img.alt = `${lb.product?.sku || ""} — צילום ${nf.format(lb.i + 1)}`;
  lb.cap.textContent = `${nf.format(lb.i + 1)} מתוך ${nf.format(lb.list.length)}${lb.product ? ` · ${lb.product.sku}` : ""}`;
}

function closeLightbox() {
  lb.root.hidden = true;
  document.body.style.overflow = "";
  lb.lastFocus?.focus?.();
}

const step = (n) => {
  if (!lb.list.length) return;
  lb.i = (lb.i + n + lb.list.length) % lb.list.length;
  renderLightboxFrame();
};

$("#lightbox-close")?.addEventListener("click", closeLightbox);
// In RTL the visually-left arrow advances, so `next` is the left control.
$("#lightbox-next")?.addEventListener("click", () => step(1));
$("#lightbox-prev")?.addEventListener("click", () => step(-1));
lb.root?.addEventListener("click", (e) => {
  if (e.target === lb.root) closeLightbox();
});

/* ------------------------------------------------------- scroll reveal */

let io = null;

function setupReveal() {
  if (reduceMotion.matches || !("IntersectionObserver" in window)) return;
  document.documentElement.classList.add("has-anim");
  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.02 }
  );
}

/* Mark new nodes for the entrance transition and observe them. A fallback
   timer guarantees they become visible even if the observer never fires —
   content must never depend on an animation completing. */
function revealIn(root) {
  const targets = [...root.querySelectorAll(".card, .series-card, .stat-card, .prose > *, .detail > *, .gallery")];
  for (const t of targets) {
    if (t.classList.contains("is-in")) continue;
    t.classList.add("will-reveal");
    if (io) io.observe(t);
    else t.classList.add("is-in");
  }
  if (io) setTimeout(() => targets.forEach((t) => t.classList.add("is-in")), 1400);
}

/* -------------------------------------------------------- count-up stat */

function countUp() {
  for (const b of $$("[data-count]")) {
    const to = Number(b.dataset.count);
    if (reduceMotion.matches) {
      b.textContent = num(to);
      continue;
    }
    const dur = 900;
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      b.textContent = num(Math.round(to * eased));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

/* ------------------------------------------------------ progress + top */

function setupChrome() {
  const bar = el("div", { className: "scroll-progress", id: "scroll-progress", "aria-hidden": "true" });
  const top = el("button", { className: "to-top", type: "button", "aria-label": "חזרה לראש העמוד", onclick: () => window.scrollTo({ top: 0, behavior: reduceMotion.matches ? "auto" : "smooth" }) }, svg(ICON.arrowUp));
  document.body.append(bar, top);

  const onScroll = () => {
    const h = document.documentElement.scrollHeight - window.innerHeight;
    const k = h > 0 ? Math.min(1, window.scrollY / h) : 0;
    bar.style.transform = `scaleX(${k})`;
    top.classList.toggle("is-on", window.scrollY > 700);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

/* ------------------------------------------------------------------ nav */

const navToggle = $("#nav-toggle");
const nav = $("#primary-nav");

navToggle?.addEventListener("click", () => {
  const open = nav.classList.toggle("is-open");
  navToggle.setAttribute("aria-expanded", String(open));
});

nav?.addEventListener("click", (e) => {
  if (e.target.closest("a")) {
    nav.classList.remove("is-open");
    navToggle?.setAttribute("aria-expanded", "false");
  }
});

function markNav(name) {
  const target = name === "product" ? "#/" : `#${name}`;
  for (const a of $$(".primary-nav a")) {
    if (a.getAttribute("href") === target) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

/* Global keys: "/" focuses search (a catalogue convention), Escape unwinds
   whatever overlay is open. */
document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
  if (e.key === "/" && !typing) {
    const q = $("#q");
    if (q) {
      e.preventDefault();
      q.focus();
      q.select();
    }
    return;
  }
  if (e.key === "Escape") {
    if (!lb.root.hidden) closeLightbox();
    else {
      const sug = $("#suggest");
      if (sug && !sug.hidden) sug.hidden = true;
      else if (nav?.classList.contains("is-open")) {
        nav.classList.remove("is-open");
        navToggle?.setAttribute("aria-expanded", "false");
      }
    }
  }
  if (!lb.root.hidden && e.key === "ArrowLeft") step(1);
  if (!lb.root.hidden && e.key === "ArrowRight") step(-1);
});

/* ----------------------------------------------------------------- boot */

const main = $("#main");

/* Each view owns exactly one h1, and it must be the first heading in
   document order. */
function enforceSingleH1() {
  const seen = new Set();
  for (const h of main.querySelectorAll("h1")) {
    if (seen.has(h.textContent.trim())) h.remove();
    else seen.add(h.textContent.trim());
  }
}

function ensureFooterCount() {
  let node = $("#footer-count");
  if (!node) {
    const host = $(".footer-bottom");
    if (!host) return;
    node = el("p", { className: "footer-meta", id: "footer-count" });
    host.prepend(node);
  }
  node.textContent = `${num(state.products.length)} דגמים · ${num(totalPhotos())} צילומים · הופק ${new Date(state.products[0]?.generated || Date.now()).toLocaleDateString("he-IL")}`;
}

async function boot() {
  loadFavs();
  setupReveal();
  setupChrome();

  const [pd, id] = await Promise.all([
    fetch(DATA_URL).then((r) => r.json()),
    fetch(IMG_URL).then((r) => r.json()).catch(() => ({ images: {} })),
  ]);

  state.products = pd.products;
  state.images = id.images || {};

  ensureFooterCount();
  document.title = `טסטשיי — ${num(pd.total)} דגמי אביזרי אמבטחה`;
  document.documentElement.lang = "he";
  document.documentElement.dir = "rtl";

  render();
  window.addEventListener("hashchange", render);

  // Same-page anchor links (#grid, #/about#specs) must scroll, not re-route
  // into a dead view; the router only handles "#/...".
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const href = a.getAttribute("href");
    if (href === "#" || href.startsWith("#/")) return;
    const target = document.querySelector(href);
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "start" });
  });
}

function render() {
  // Ignore plain in-page anchors so they don't reset the route.
  const raw = location.hash.replace(/^#/, "");
  if (raw && !raw.startsWith("/")) return;

  const route = parseHash();
  markNav(route.name === "product" ? "/" : route.name);

  if (route.name === "product") renderProduct(main, route.id);
  else if (route.name === "/series") renderSeries(main);
  else if (route.name === "/about") renderAbout(main);
  else renderCatalogue(main);

  enforceSingleH1();
  if (route.name === "/") countUp();
  revealIn(main);
  main.focus({ preventScroll: true });
  if (!location.hash.includes("#grid")) window.scrollTo({ top: 0, behavior: "instant" });
}

boot();
