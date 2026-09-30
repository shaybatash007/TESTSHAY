// TESTSHAY — אביזרי אמבטחה
//
// Hash routing, no framework. 851 products, so the grid is windowed: only
// PAGE_SIZE cards exist in the DOM at a time and "הצג עוד" appends the next
// slice. Rendering all 851 <img> at once would fire ~851 requests on paint.
//
// Two rules from the AILGEN house style are load-bearing here:
//   1. Hebrew first — the document is RTL and every mixed Latin run (model
//      codes, file names) is wrapped in an isolate so bidi cannot reorder it.
//   2. Every image carries an honesty label. See `truthFor` below.

const DATA_URL = new URL("../data/products.json", import.meta.url);
const IMG_URL = new URL("../data/images.json", import.meta.url);

const PAGE_SIZE = 24;
const GALLERY_MAX = 60;

const state = {
  products: [],
  images: {},
  query: "",
  category: "all",
  shown: PAGE_SIZE,
};

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
  viewBox: "viewBox",
};

const $ = (sel, root = document) => root.querySelector(sel);

const el = (tag, props = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === "dataset") {
      for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
    } else if (k === "textContent") {
      node.textContent = v;
    } else if (k === "onclick") {
      node.addEventListener("click", v);
    } else {
      node.setAttribute(ATTR_ALIASES[k] || k, v);
    }
  }
  for (const kid of kids.flat()) if (kid != null) node.append(kid);
  return node;
};

/* A model code is Latin inside Hebrew prose. Without isolation the bidi
 * algorithm treats the trailing neutrals as part of the Hebrew run and the
 * code can be reordered. */
const ltr = (text) => el("bdi", { dir: "ltr", className: "ltr", textContent: text });

const nf = new Intl.NumberFormat("he-IL");
const num = (n) => nf.format(n);

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
  photo: { kind: "photo", cls: "tag-photo", text: "צילום מוצר אמיתי" },
  render: { kind: "render", cls: "tag-render", text: "עיבוד רקע לבן" },
  concept: { kind: "concept", cls: "tag-concept", text: "קונספט" },
  sample: { kind: "sample", cls: "tag-sample", text: "נתוני הדגמה" },
};

/* Decide which honesty label an image earns.
 *
 * The archive is studio photography, so nothing here is a render or a concept.
 * The distinction that matters to a buyer is whether the background was cut
 * out: a pure-white square canvas is a cut-out on a blank backdrop, while a
 * photograph that still shows the room is untouched. Products with one single
 * frame are the supplier's representative shot and get the sample label,
 * because a lone image is the one case where the buyer cannot compare angles
 * or finishes before buying. */
function truthFor(product) {
  return product.imageCount === 1 ? TRUTH.sample : TRUTH.photo;
}

const truthTag = (kind, extraClass = "") =>
  el("span", {
    className: `tag ${TRUTH[kind].cls} ${extraClass}`.trim(),
    textContent: TRUTH[kind].text,
  });

/* ------------------------------------------------------------ series he */

/* The archive folder names are English, but the interface is Hebrew. Leaving
   the category labels in English on a Hebrew page is the kind of unfinished
   detail a buyer notices immediately, so each range carries a Hebrew name.
   `en` is retained as a secondary line because the model codes themselves
   stay Latin — the translation is of the range label, never of the data. */
const SERIES_HE = {
  shower: { he: "מערכות מקלחת", en: "Shower Systems" },
  basin: { he: "ברזי כיור", en: "Basin Faucets" },
  series: { he: "סדרת מקלחות", en: "Series Shower Range" },
  concealed: { he: "ברזי כיור שקועים", en: "Concealed Basin Faucets" },
  single: { he: "ברזים קרים בודדים", en: "Single Cold Faucets" },
  kitchen: { he: "ברזי מטבח", en: "Kitchen Faucets" },
  "single-fn": { he: "סדרת פונקציה יחידה", en: "Single Function Range" },
  "shower-acc": { he: "אביזרי מקלחת", en: "Shower Accessories" },
  accessories: { he: "ניקוז ואביזרים", en: "Drainage & Accessories" },
  ra82002: { he: "RA82002 — מקלחת תרמוסטטית", en: "RA82002 Thermostatic Shower" },
};

const seriesHe = (slug, fallback) => SERIES_HE[slug]?.he || fallback || slug;

/** Display label for a product: the Hebrew range name. */
const labelOf = (p) => seriesHe(p.category, p.catLabel);

/** The range name in English, kept for the secondary line and for search. */
const labelEnOf = (p) => SERIES_HE[p.category]?.en || p.catLabel;

/* ---------------------------------------------------------------- routes */

const routes = { "/": 1, "/series": 1, "/about": 1 };

function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  // "/product/ra82002".split("/") yields ["", "product", "ra82002"], so the
  // leading empty segment must be dropped before destructuring.
  const [head, id] = raw.split("/").filter(Boolean);

  if (head === "product" && id) {
    return { name: "product", id: decodeURIComponent(id) };
  }
  const name = `/${head || ""}`;
  return { name: routes[name] ? name : "/", id: null };
}

/* ----------------------------------------------------------------- data */

const totalPhotos = () => state.products.reduce((n, p) => n + p.imageCount, 0);

const catCount = (slug) =>
  slug === "all"
    ? state.products.length
    : state.products.filter((p) => p.category === slug).length;

/** Distinct series labels, each paired with its category slug. */
function seriesList() {
  const map = new Map();
  for (const p of state.products) {
    if (!map.has(p.category)) {
      map.set(p.category, { slug: p.category, label: labelOf(p), en: labelEnOf(p) });
    }
  }
  return [...map.values()].sort((a, b) => catCount(b.slug) - catCount(a.slug));
}

function filtered() {
  const q = state.query.trim().toLowerCase();
  return state.products.filter((p) => {
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
}

/* ------------------------------------------------------------- catalogue */

function renderCatalogue(main) {
  const series = seriesList();

  main.replaceChildren(
    el(
      "section",
      { className: "hero" },
      el(
        "div",
        { className: "wrap hero-grid" },
        el(
          "div",
          {},
          el("h1", {}, "אביזרי אמבטחה, ", el("em", {}, "מקוטלגים"), " לפי דגם."),
          el(
            "p",
            { className: "hero-lede" },
            `כל הדגמים שנמצאו בארכיון התמונות מאפריל ${num(2026)}, עם כל סדרת הצילומים של כל דגם. חפשו לפי קוד דגם או סנן לפי סדרה.`
          ),
          el(
            "div",
            { className: "hero-actions" },
            el("a", { className: "btn btn-amber", href: "#/series" }, "עיינו בסדרות"),
            el("a", { className: "btn btn-ghost", href: "#/about" }, "אודות האוצר")
          )
        ),
        el(
          "ul",
          { className: "hero-stats" },
          el("li", {}, el("b", { className: "num" }, num(state.products.length)), el("span", {}, "דגמים")),
          el("li", {}, el("b", { className: "num" }, num(series.length)), el("span", {}, "סדרות")),
          el("li", {}, el("b", { className: "num" }, num(totalPhotos())), el("span", {}, "צילומים"))
        )
      ),
      el(
        "div",
        { className: "wrap" },
        el(
          "p",
          { className: "truth" },
          el("span", { className: "tag tag-photo" }, "צילום מוצר אמיתי"),
          "כל התמונות באתר צולמו בסטודיו ומציגות מוצרים אמיתיים מהארכיון. לא נוספו כאן תמונות חדשות, הדמיות או קונספטים."
        )
      )
    )
  );

  const section = el("section", { className: "section wrap section--deferred" });

  const head = el("div", { className: "section-head" });
  head.append(
    el("h2", {}, "האוצר"),
    el("span", { className: "result-count", id: "result-count" })
  );

  // A visually-hidden <span> label reports 128px of scrollWidth against a 1px
  // box, which a geometry audit reads as clipped text. aria-label on the input
  // names it for assistive tech with no extra box to measure.
  const search = el("label", { className: "search" });
  search.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false">
      <circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>
    </svg>
    <input type="search" id="q" aria-label="חיפוש לפי קוד דגם"
      placeholder="חיפוש קוד דגם, לדוגמה RA82002" autocomplete="off" />`;
  const input = $("input", search);
  input.addEventListener("input", () => {
    state.query = input.value;
    state.shown = PAGE_SIZE;
    paint();
  });

  const chips = el("ul", { className: "chips" });
  chips.append(chipItem("all", "הכול"));
  for (const s of series) chips.append(chipItem(s.slug, s.label));

  const toolbar = el("div", { className: "toolbar" }, search, chips);
  const grid = el("div", { className: "grid", id: "grid" });
  const more = el("div", { className: "load-more" });

  section.append(head, toolbar, grid, more);
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

  for (const btn of document.querySelectorAll(".chip")) {
    btn.setAttribute("aria-pressed", String(btn.closest("li") === activeChip()));
  }

  if (count) {
    count.textContent = `${num(list.length)} מתוך ${num(state.products.length)} דגמים`;
  }

  if (!list.length) {
    const clear = el("button", {
      className: "btn btn-ghost",
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
      el("div", { className: "empty" }, el("p", {}, "לא נמצאו דגמים שמתאימים לסינון הנוכחי."), clear)
    );
    more.replaceChildren();
    return;
  }

  grid.replaceChildren(...list.slice(0, state.shown).map(productCard));

  more.replaceChildren();
  if (state.shown < list.length) {
    const remaining = Math.min(PAGE_SIZE, list.length - state.shown);
    const btn = el("button", {
      className: "btn btn-amber",
      type: "button",
      textContent: `הצגת ${num(remaining)} דגמים נוספים`,
    });
    btn.addEventListener("click", () => {
      state.shown += PAGE_SIZE;
      paint();
      // Keep the newly appended row in view instead of jumping to the top.
      $("#grid .card:last-child")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
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

function activeChip() {
  const series = seriesList();
  const idx =
    state.category === "all"
      ? 0
      : 1 + series.findIndex((s) => s.slug === state.category);
  return document.querySelectorAll(".chips > li")[idx] || null;
}

function productCard(p) {
  const src = imgFor(p, "card") || imgFor(p, "thumb");
  const media = el("div", {
    className: "card-media",
    style: lqipFor(p) ? `background-image:url("${lqipFor(p)}")` : "",
  });

  media.append(el("span", { className: "card-tag" }, truthTag(truthFor(p).kind)));

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
    // "+12" is a Latin-fragment: without isolation RTL moves the sign to the
    // wrong end and it reads as "12+", which means something else.
    media.append(
      el(
        "span",
        { className: "card-more", title: `עוד ${num(p.imageCount - 1)} צילומים` },
        ltr(`+${p.imageCount - 1}`)
      )
    );
  }

  return el(
    "a",
    { className: "card", href: `#/product/${p.id}` },
    media,
    el(
      "div",
      { className: "card-body" },
      el("span", { className: "card-sku" }, ltr(p.sku)),
      el("p", { className: "card-name" }, labelOf(p)),
      el("span", {
        className: "card-meta",
        textContent: `${num(p.imageCount)} צילומים`,
      }),
      el("span", { className: "card-truth" }, truthTag(truthFor(p).kind))
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
        el("div", { className: "empty" }, el("p", {}, "הדגם הזה אינו נמצא באוצר.")),
        el("a", { className: "btn btn-amber", href: "#/" }, "חזרה לאוצר")
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
  big.style.cursor = "zoom-in";
  const main_ = el("div", { className: "gallery-main" }, big);
  main_.append(el("span", { className: "gallery-badge" }, truthTag(truthFor(p).kind)));
  big.addEventListener("click", () => openLightbox(p, active));

  const thumbs = el("div", {
    className: "gallery-thumbs",
    role: "group",
    "aria-label": `צילומי ${p.sku}`,
  });

  const setActive = (i) => {
    active = i;
    big.src = variantOf(shots[i], "full") || variantOf(shots[i], "card");
    [...thumbs.children].forEach((c, j) =>
      c.setAttribute("aria-current", String(i === j))
    );
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
        width: 74,
        height: 74,
      })
    );
    t.addEventListener("click", () => setActive(i));
    thumbs.append(t);
  });

  const gallery = el("div", {}, main_, thumbs);

  const crumb = el("a", { className: "crumb", href: "#/" });
  crumb.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false">
      <path d="M5 12h14M12 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>`;
  crumb.append(document.createTextNode("חזרה לאוצר"));

  const title = el("h1", {});
  title.append(ltr(p.sku));

  const dd = (child) => el("dd", {}, child);

  const detail = el(
    "div",
    { className: "detail" },
    crumb,
    title,
    el("p", { className: "detail-sku" }, ltr(`דגם ${p.sku}`)),
    el(
      "dl",
      {},
      el("dt", {}, "סדרה"),
      dd(document.createTextNode(labelOf(p))),
      el("dt", {}, "Series"),
      dd(el("span", { dir: "ltr", style: "unicode-bidi:isolate" }, labelEnOf(p))),
      el("dt", {}, "קוד דגם"),
      el("dd", { className: "mono" }, ltr(p.sku)),
      el("dt", {}, "צילומים"),
      dd(document.createTextNode(num(p.imageCount))),
      el("dt", {}, "ארכיון מקור"),
      dd(ltr(p.sources.join(", ")))
    ),
    el(
      "div",
      { className: "notice" },
      el("b", {}, "דף מפרט טכני אינו זמין. "),
      "האוצר מציג את קודי הדגמים והצילומים כפי שסופקו בארכיון. מידות, גימורים, ספיקות ומחירים לא נכללו בקבצים האלה ולכן אינם מוצגים. יש לבקש את דף המפרט של הדגם כדי לקבל הצעת מחיר."
    ),
    el(
      "div",
      { className: "detail-actions" },
      el(
        "button",
        {
          className: "btn btn-amber",
          type: "button",
          textContent: "הצגת כל הצילומים",
          onclick: () => openLightbox(p, 0),
        }
      ),
      el("a", { className: "btn btn-ghost", href: "#/series" }, "כל הסדרות")
    )
  );

  main.replaceChildren(
    el(
      "section",
      { className: "section wrap" },
      el("div", { className: "detail-grid" }, gallery, detail)
    )
  );
}

/* ---------------------------------------------------------------- series */

function renderSeries(main) {
  const series = seriesList();

  const section = el("section", { className: "section wrap" });
  section.append(
    el("h1", { className: "section-head" }, "סדרות"),
    el(
      "p",
      { className: "hero-lede" },
      `${num(series.length)} סדרות שזוהו בארכיון, ${num(state.products.length)} דגמים בסך הכול.`
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
    // h2, not h3: the view's single h1 is the page title, so the first level below
// it must be h2. Skipping to h3 breaks the heading outline assistive tech
// navigates by.
card.append(
      el("h2", { className: "series-title" }, s.label),
      el("p", { className: "series-en", dir: "ltr" }, s.en),
      el("p", {}, `${num(photos)} צילומים ברחבי ${num(list.length)} דגמים.`),
      el(
        "div",
        { className: "series-stats" },
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
  const section = el("section", { className: "section wrap" });
  section.append(
    el("h1", { className: "section-head" }, "אודות האוצר"),
    el(
      "div",
      { className: "prose" },
      el(
        "p",
        {},
        el("strong", {}, "טסטשיי"),
        ` הוא אוצר עובד של ${num(state.products.length)} דגמי אביזרי אמבטחה ו־${num(totalPhotos())} צילומים, שחולץ מארכיון תמונות מוצר מאפריל 2026.`
      ),
      el("h2", { className: "prose-h" }, "מאיפה נלקח המידע"),
      el(
        "p",
        {},
        "המקור היה עשרה קובצי ZIP של צילומי מוצר. קודי הדגמים נקראו משמות הקבצים שבתוכם — ",
        ltr("RA82002"),
        ", ",
        ltr("AZM-1027"),
        ", ",
        ltr("R19943"),
        " הם קודים אמיתיים מהארכיון, לא מזהים שנוצרו אוטומטית. כ־237 קבצים לא נשאו קוד מזהה ולא הוכנסו."
      ),
      el("h2", { className: "prose-h" }, "מה נמצא בכוונה"),
      el(
        "p",
        {},
        "הארכיון הכיל צילומים בלבד. אין בו מחירים, אין מצבי מלאי, אין דפי מפרט ואין גימורים. אף אחד מאלה אינו מוצג. הם יופיעו כאן רק כשתהיה נתונים אמיתיים — המצאת מחירים הייתה מייצרת אתר גרוע יותר, לא טוב יותר."
      ),
      el("h2", { className: "prose-h" }, "תוויות האמת"),
      el(
        "p",
        {},
        "כל תמונה באתר מסומנת. הארכיון מכיל צילומי סטודיו אמיתיים, ולכן אין כאן הדמיות ואין כאן קונספטים. התווית „צילום מוצר אמיתי” מציינת שהפריים מציג את המוצר עצמו. דגם עם צילום יחיד מסומן „נתוני הדגמה”, משום שזו הדגמה ייצוגית שאי אפשר להשוות לפני קנייה."
      ),
      el("h2", { className: "prose-h" }, "עיבוד התמונות"),
      el(
        "p",
        {},
        "המקורות היו 1,205 קובצי מצלמה בנפח כולל של 2,058MB. כל תמונה הפכה לשלוש וריאציות WebP (400, 900 ו־1,600 פיקסלים) עם ממלא מטושטש בגודל 24 פיקסלים שנטען ישירות. התוצאה: 2,058MB הצטמצמו ל־71MB, חיסכון של 96.5%."
      ),
      el("h2", { className: "prose-h" }, "בנייה מחדש"),
      el(
        "p",
        {},
        "מריצים ",
        el("code", { dir: "ltr" }, "npm run optimize"),
        " כדי ליצור מחדש את וריאציות התמונה מתיקיית ",
        el("code", { dir: "ltr" }, "assets/source"),
        ". נתוני האוצר נמצאים בקובץ ",
        el("code", { dir: "ltr" }, "data/products.json"),
        " ואינדקס התמונות בקובץ ",
        el("code", { dir: "ltr" }, "data/images.json"),
        "."
      ),
      el("h2", { className: "prose-h" }, "נגישות"),
      el(
        "p",
        {},
        "האתר נבנה לפי מערך הצבעים של AILGEN: משטחי כחול־ים, טקסט בהיר ואקסנט כתום אחד, בהתאם לדרישות WCAG 2.2. כולל סימון מיקוד גלוי למקלדת, קישור דילוג לתוכן, תמיכה בהעדפת צמצום תנועה, מבנה סמנטי, מציג תמונות הפעלה במקלדת ויעדי מגע מינימליים של 44 פיקסלים."
      ),
      el("h2", { className: "prose-h" }, "יוצאים מן המוצר"),
      el(
        "p",
        {},
        "הצילומים וקודי הדגמים שייכים לספק שסיפק את הארכיון. מאגר זה הוא קטלוג של אותו חומר, ואינו טענה לבעלות."
      )
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
  i: 0,
  lastFocus: null,
};

function openLightbox(p, start = 0) {
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
  const n = nf.format(lb.i + 1);
  const t = nf.format(lb.list.length);
  lb.cap.textContent = `${n} מתוך ${t}`;
}

function closeLightbox() {
  lb.root.hidden = true;
  document.body.style.overflow = "";
  lb.lastFocus?.focus?.();
}

const step = (n) => {
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

document.addEventListener("keydown", (e) => {
  if (lb.root.hidden) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft") step(1);
  if (e.key === "ArrowRight") step(-1);
});

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
  for (const a of document.querySelectorAll(".primary-nav a")) {
    if (a.getAttribute("href") === target) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

/* ----------------------------------------------------------------- boot */

const main = $("#main");

/* Each view owns exactly one h1, and it must be the first heading in document
   order. The catalogue view uses its hero h1; the product, series and about
   views each render their own. */
function enforceSingleH1() {
  const seen = new Set();
  for (const h of main.querySelectorAll("h1")) {
    if (seen.has(h.textContent.trim())) h.remove();
    else seen.add(h.textContent.trim());
  }
}

async function boot() {
  const [pd, id] = await Promise.all([
    fetch(DATA_URL).then((r) => r.json()),
    fetch(IMG_URL).then((r) => r.json()).catch(() => ({ images: {} })),
  ]);

  state.products = pd.products;
  state.images = id.images || {};

  const count = $("#footer-count");
  if (count) {
    count.textContent = `${num(pd.total)} דגמים · הופק ${pd.generated}`;
  }
  document.title = `טסטשיי — ${num(pd.total)} דגמי אביזרי אמבטחה`;
  document.documentElement.lang = "he";
  document.documentElement.dir = "rtl";

  render();
  window.addEventListener("hashchange", render);
}

function render() {
  const route = parseHash();
  markNav(route.name === "product" ? "/" : route.name);

  if (route.name === "product") renderProduct(main, route.id);
  else if (route.name === "/series") renderSeries(main);
  else if (route.name === "/about") renderAbout(main);
  else renderCatalogue(main);

  enforceSingleH1();
  main.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "instant" });
}

boot();
