// TESTSHAY storefront.
//
// Hash routing, no framework. The catalogue is 851 products, so the grid is
// windowed: only PAGE_SIZE cards are in the DOM at a time and "Load more"
// appends the next slice. Rendering all 851 <img> at once would fire ~851
// requests on first paint.

const DATA_URL = new URL("../data/products.json", import.meta.url);
const IMG_URL = new URL("../data/images.json", import.meta.url);

const PAGE_SIZE = 24;

const state = {
  products: [],
  images: {},
  query: "",
  category: "all",
  shown: PAGE_SIZE,
};

/* ------------------------------------------------------------------ util */

const $ = (sel, root = document) => root.querySelector(sel);
// Properties such as `dataset` are read-only accessors, so a plain
// Object.assign throws on them. Attributes are set explicitly, with the
// camelCase-to-kebab mapping HTML expects.
const ATTR_ALIASES = {
  className: "class",
  htmlFor: "for",
  tabIndex: "tabindex",
  ariaCurrent: "aria-current",
  ariaExpanded: "aria-expanded",
  ariaPressed: "aria-pressed",
  ariaControls: "aria-controls",
  ariaLabel: "aria-label",
  ariaHidden: "aria-hidden",
  srcSet: "srcset",
};

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
  for (const kid of kids.flat()) {
    if (kid != null) node.append(kid);
  }
  return node;
};

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

// Image variants are keyed by the original filename with its extension
// stripped, which is exactly the stem the optimiser wrote to disk.
const keyOf = (file) => file.replace(/\.[^.]+$/, "");

const variantOf = (file, kind) => {
  if (!file) return "";
  const rec = state.images[keyOf(file)];
  return rec ? rec[kind] || "" : "";
};

const imgFor = (product, kind) => variantOf(product.images[0], kind);

const lqipFor = (product) => {
  const rec = state.images[keyOf(product.images[0] || "")];
  return rec ? rec.lqip : "";
};

const catCount = (slug) =>
  slug === "all" ? state.products.length : state.products.filter((p) => p.category === slug).length;

function filtered() {
  const q = state.query.trim().toLowerCase();
  return state.products.filter((p) => {
    if (state.category !== "all" && p.category !== state.category) return false;
    if (!q) return true;
    return (
      p.sku.toLowerCase().includes(q) ||
      p.catLabel.toLowerCase().includes(q) ||
      p.sources.some((s) => s.toLowerCase().includes(q))
    );
  });
}

/* --------------------------------------------------------------- routing */

const routes = {
  "/": renderCatalogue,
  "/ranges": renderRanges,
  "/about": renderAbout,
};

function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  // "/product/ra82002".split("/") yields ["", "product", "ra82002"], so the
  // leading empty segment must be dropped before destructuring.
  const segs = raw.split("/").filter(Boolean);
  const [head, id] = segs;

  if (head === "product" && id) {
    return { name: "product", id: decodeURIComponent(id) };
  }
  const name = `/${head || ""}`;
  return { name: routes[name] ? name : "/", id: null };
}

const go = (hash) => {
  location.hash = hash;
};

/* ----------------------------------------------------------------- views */

function renderCatalogue(main) {
  const cats = [...new Set(state.products.map((p) => p.catLabel))].sort();

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
          el("h1", {}, "Bathroom fixtures, ", el("em", {}, "catalogued"), " by model."),
          el(
            "p",
            { className: "hero-lede" },
            "Every model in the 2026-04 product archive, with its full photograph set. Filter by range or search a model code."
          ),
          el(
            "div",
            { className: "hero-actions" },
            el("a", { className: "btn btn-primary", href: "#/ranges" }, "Browse ranges"),
            el(
              "a",
              { className: "btn btn-ghost", href: "#/about" },
              "About this catalogue"
            )
          )
        ),
        el(
          "ul",
          { className: "hero-stats" },
          el("li", {}, el("b", {}, state.products.length), el("span", {}, "Models")),
          el("li", {}, el("b", {}, cats.length), el("span", {}, "Ranges")),
          el(
            "li",
            {},
            el(
              "b",
              {},
              state.products.reduce((n, p) => n + p.imageCount, 0).toLocaleString()
            ),
            el("span", {}, "Photos")
          )
        )
      )
    )
  );

  const section = el("section", { className: "section wrap section--deferred" });
  const head = el("div", { className: "tier-title" });
  head.append(el("h2", {}, "Catalogue"), el("span", { className: "result-count" }));

  const search = el("label", { className: "search" });
  search.innerHTML = `
    <span class="sr-only">Search by model code</span>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>
    </svg>
    <input type="search" id="q" placeholder="Search model code, e.g. RA82002" autocomplete="off" />`;
  const input = $("input", search);
  input.addEventListener("input", () => {
    state.query = input.value;
    state.shown = PAGE_SIZE;
    paint();
  });

  const chips = el("ul", { className: "chips" });
  const mkChip = (slug, label) => {
    const li = el("li", {});
    const b = el(
      "button",
      {
        className: "chip",
        type: "button",
        "aria-pressed": String(state.category === slug),
        textContent: `${label} (${catCount(slug)})`,
      }
    );
    b.addEventListener("click", () => {
      state.category = slug;
      state.shown = PAGE_SIZE;
      paint();
    });
    li.append(b);
    return li;
  };
  chips.append(mkChip("all", "All"));
  for (const cat of cats) {
    const p = state.products.find((x) => x.catLabel === cat);
    chips.append(mkChip(p.category, cat));
  }

  const toolbar = el("div", { className: "toolbar" }, search, chips);
  const grid = el("div", { className: "grid", id: "grid" });
  const more = el("div", { className: "load-more" });

  section.append(head, toolbar, grid, more);
  main.append(section);
  paint();
}

function paint() {
  const grid = $("#grid");
  const more = $(".load-more");
  const count = $(".result-count");
  if (!grid) return;

  const list = filtered();

  syncChips();

  if (count) count.textContent = `${list.length.toLocaleString()} of ${state.products.length.toLocaleString()} models`;

  if (!list.length) {
    grid.replaceChildren(
      el(
        "div",
        { className: "empty" },
        el("p", {}, "No models match that filter."),
        el(
          "button",
          {
            className: "btn btn-ghost",
            type: "button",
            textContent: "Clear filters",
          }
        )
      )
    );
    $("button", grid)?.addEventListener("click", () => {
      state.query = "";
      state.category = "all";
      state.shown = PAGE_SIZE;
      const q = $("#q");
      if (q) q.value = "";
      paint();
    });
    more.replaceChildren();
    return;
  }

  const slice = list.slice(0, state.shown);
  grid.replaceChildren(...slice.map(productCard));

  more.replaceChildren();
  if (state.shown < list.length) {
    const btn = el(
      "button",
      {
        className: "btn btn-primary",
        type: "button",
        textContent: `Load ${Math.min(PAGE_SIZE, list.length - state.shown)} more`,
      }
    );
    btn.addEventListener("click", () => {
      state.shown += PAGE_SIZE;
      paint();
    });
    more.append(btn);
  }

  // Fade images in once decoded so the blurred placeholder does the work.
  for (const img of grid.querySelectorAll("img[data-src]")) {
    const node = img;
    const done = () => node.classList.add("is-loaded");
    node.addEventListener("load", done, { once: true });
    node.addEventListener("error", done, { once: true });
    node.src = node.dataset.src;
  }
}

function syncChips() {
  const cats = [...new Set(state.products.map((p) => p.catLabel))].sort();
  const chips = document.querySelectorAll(".chip");
  chips.forEach((chip, i) => {
    const slug = i === 0 ? "all" : state.products.find((x) => x.catLabel === cats[i - 1]).category;
    chip.setAttribute("aria-pressed", String(state.category === slug));
  });
}

function productCard(p) {
  const src = imgFor(p, "card") || imgFor(p, "thumb");
  const media = el("div", {
    className: "card-media",
    style: lqipFor(p) ? `background-image:url("${lqipFor(p)}")` : "",
  });
  if (src) {
    media.append(
      el("img", {
        src,
        alt: `${p.sku} — ${p.catLabel}`,
        loading: "lazy",
        decoding: "async",
        width: 400,
        height: 400,
        dataset: { src },
      })
    );
  }
  if (p.imageCount > 1) {
    media.append(el("span", { className: "card-more", textContent: `+${p.imageCount - 1}` }));
  }

  return el(
    "a",
    { className: "card", href: `#/product/${p.id}` },
    media,
    el(
      "div",
      { className: "card-body" },
      el("span", { className: "card-sku", textContent: p.sku }),
      el("p", { className: "card-name", textContent: p.catLabel }),
      el("span", {
        className: "card-count",
        textContent: `${p.imageCount} photo${p.imageCount === 1 ? "" : "s"}`,
      })
    )
  );
}

function renderProduct(main, id) {
  const p = state.products.find((x) => x.id === id);
  if (!p) {
    main.replaceChildren(
      el(
        "section",
        { className: "section wrap" },
        el("div", { className: "empty" }, el("p", {}, "That model is not in the catalogue.")),
        el("a", { className: "btn btn-primary", href: "#/" }, "Back to catalogue")
      )
    );
    return;
  }

  let active = 0;
  const gallery = el("div", {});
  const big = el("img", {
    src: imgFor(p, "full") || imgFor(p, "card"),
    alt: `${p.sku} — ${p.catLabel}`,
    width: 900,
    height: 900,
  });
  big.style.background = lqipFor(p) ? `url("${lqipFor(p)}") center/cover` : "";
  const main_ = el("div", { className: "gallery-main" }, big);
  main_.append();
  big.addEventListener("click", () => openLightbox(p, active));
  big.style.cursor = "zoom-in";

  const thumbs = el("div", { className: "gallery-thumbs", role: "group", "aria-label": "Product images" });
  const setActive = (i) => {
    active = i;
    const s = imgForAt(p, i, "full") || imgForAt(p, i, "card");
    big.src = s;
    [...thumbs.children].forEach((c, j) => c.setAttribute("aria-current", String(i === j)));
  };

  p.images.slice(0, 60).forEach((_, i) => {
    const t = el("button", { type: "button", "aria-current": String(i === 0), "aria-label": `Image ${i + 1}` });
    const im = el("img", {
      src: imgForAt(p, i, "thumb"),
      alt: "",
      loading: "lazy",
      decoding: "async",
      width: 72,
      height: 72,
    });
    t.append(im);
    t.addEventListener("click", () => setActive(i));
    thumbs.append(t);
  });

  gallery.append(main_, thumbs);

  const detail = el(
    "div",
    { className: "detail" },
    el("a", { className: "back-link", href: "#/" }, "← Back to catalogue"),
    el("h1", {}, p.sku),
    el("p", { className: "detail-sku", textContent: `Model ${p.sku}` }),
    el(
      "dl",
      {},
      el("dt", {}, "Range"),
      el("dd", {}, p.catLabel),
      el("dt", {}, "Model code"),
      el("dd", { style: "font-family:'Cascadia Code',Consolas,monospace;direction:ltr" }, p.sku),
      el("dt", {}, "Photographs"),
      el("dd", {}, p.imageCount.toLocaleString()),
      el("dt", {}, "Source archive"),
      el("dd", {}, p.sources.join(", "))
    ),
    el(
      "div",
      { className: "notice" },
      el("strong", {}, "Specification sheet not available. "),
      "This catalogue reproduces the model codes and photography from the source archive. Dimensions, finishes, flow rates and prices were not included in those files, so none are listed here. Request the spec sheet for this model to quote it."
    ),
    el(
      "div",
      { style: "display:flex;gap:12px;flex-wrap:wrap;margin-top:24px" },
      el(
        "button",
        {
          className: "btn btn-primary",
          type: "button",
          textContent: "View all photos",
          onclick: () => openLightbox(p, 0),
        }
      ),
      el("a", { className: "btn btn-ghost", href: "#/ranges" }, "All ranges")
    )
  );

  main.replaceChildren(
    el("section", { className: "section wrap" }, el("div", { className: "detail-grid" }, gallery, detail))
  );
}

function imgForAt(p, i, kind) {
  return variantOf(p.images[i], kind);
}

/* -------------------------------------------------------------- ranges */

function renderRanges(main) {
  const cats = [...new Set(state.products.map((p) => p.catLabel))].sort();
  const section = el("section", { className: "section wrap" });
  section.append(
    el("h1", { className: "section-title", textContent: "Ranges" }),
    el("p", {
      className: "section-lede",
      textContent: `${cats.length} ranges recovered from the archive, ${state.products.length} models in total.`,
    })
  );

  const grid = el("div", { className: "range-grid" });
  for (const cat of cats) {
    const list = state.products.filter((p) => p.catLabel === cat);
    const photos = list.reduce((n, p) => n + p.imageCount, 0);
    const slug = list[0].category;
    grid.append(
      el(
        "a",
        { className: "range-card", href: "#/", onclick: () => setTimeout(() => pickRange(slug), 0) },
        el("h3", {}, cat),
        el("p", {}, `${photos.toLocaleString()} photographs across ${list.length} models.`),
        el("span", { className: "range-n", textContent: `${list.length} models →` })
      )
    );
  }
  section.append(grid);
  main.replaceChildren(section);
}

function pickRange(slug) {
  state.category = slug;
  state.shown = PAGE_SIZE;
}

/* ---------------------------------------------------------------- about */

function renderAbout(main) {
  const section = el("section", { className: "section wrap" });
  section.innerHTML = `
    <h1 class="section-title">About this catalogue</h1>
    <div class="prose">
      <p>
        TESTSHAY is a working catalogue of <strong>${state.products.length} bathroom
        fixture models</strong> and
        <strong>${state.products.reduce((n, p) => n + p.imageCount, 0).toLocaleString()} photographs</strong>,
        extracted from a supplier archive dated 8 April 2026.
      </p>

      <h3>Where the data came from</h3>
      <p>
        The source was ten ZIP archives of product photography. Model codes were read
        from the filenames inside them — ranges such as <code>AZM-1027</code>,
        <code>RA82002</code> and <code>R19943</code> are genuine codes from the
        archive, not generated. Roughly 237 files carried no recognisable code and
        were left out.
      </p>

      <h3>What is deliberately missing</h3>
      <p>
        The archive contained photographs only. There were no prices, no stock counts,
        no dimensions and no specification sheets, so this site shows none of those.
        Prices and specs appear here only once real data exists — inventing them would
        make the catalogue worse, not better.
      </p>

      <h3>Image pipeline</h3>
      <p>
        The originals totalled about 2 GB across 1,205 files. Each image is resized to
        400, 900 and 1600 pixel WebP variants, with a 24-pixel blurred placeholder
        inlined for instant paint — a 96.5% reduction to roughly 71 MB.
      </p>

      <h3>Rebuilding</h3>
      <p>
        Run <code>npm run optimize</code> to regenerate the image variants from
        <code>assets/source</code>. The catalogue JSON lives in
        <code>data/products.json</code> and the image index in
        <code>data/images.json</code>.
      </p>
    </div>`;
  main.replaceChildren(section);
}

/* ------------------------------------------------------------- lightbox */

const lb = {
  root: $("#lightbox"),
  img: $("#lightbox-img"),
  cap: $("#lightbox-cap"),
  list: [],
  i: 0,
};

function openLightbox(p, start = 0) {
  lb.list = p.images.slice(0, 60);
  lb.i = start;
  lb.cap.textContent = `${p.sku} — ${p.catLabel}`;
  lb.root.hidden = false;
  document.body.style.overflow = "hidden";
  show();
  $("#lightbox-close")?.focus();
}

function show() {
  const file = lb.list[lb.i];
  if (!file) return;
  lb.img.src = variantOf(file, "full") || variantOf(file, "card");
  lb.cap.textContent = `${lb.i + 1} / ${lb.list.length}`;
}

function closeLightbox() {
  lb.root.hidden = true;
  document.body.style.overflow = "";
}

const step = (n) => {
  lb.i = (lb.i + n + lb.list.length) % lb.list.length;
  show();
};

$("#lightbox-close")?.addEventListener("click", closeLightbox);
$("#lightbox-prev")?.addEventListener("click", () => step(-1));
$("#lightbox-next")?.addEventListener("click", () => step(1));
lb.root?.addEventListener("click", (e) => {
  if (e.target === lb.root) closeLightbox();
});
document.addEventListener("keydown", (e) => {
  if (lb.root.hidden) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft") step(-1);
  if (e.key === "ArrowRight") step(1);
});

/* ------------------------------------------------------------------ nav */

const navToggle = $("#nav-toggle");
const nav = $("#primary-nav");
navToggle?.addEventListener("click", () => {
  const open = nav.classList.toggle("is-open");
  navToggle.setAttribute("aria-expanded", String(open));
});
nav?.addEventListener("click", (e) => {
  if (e.target.tagName === "A") {
    nav.classList.remove("is-open");
    navToggle?.setAttribute("aria-expanded", "false");
  }
});

function markNav(name) {
  for (const a of document.querySelectorAll(".primary-nav a")) {
    const href = a.getAttribute("href");
    if (href === `#${name}` || (name === "/" && href === "#/")) {
      a.setAttribute("aria-current", "page");
    } else {
      a.removeAttribute("aria-current");
    }
  }
}

/* ----------------------------------------------------------------- boot */

const main = $("#main");

async function boot() {
  const [pd, id] = await Promise.all([
    fetch(DATA_URL).then((r) => r.json()),
    fetch(IMG_URL).then((r) => r.json()).catch(() => ({ images: {} })),
  ]);

  state.products = pd.products;
  state.images = id.images || {};

  $("#footer-count").textContent = `${pd.total} models · generated ${pd.generated}`;
  document.title = `TESTSHAY — ${pd.total} Bathroom Fixtures`;

  render();
  window.addEventListener("hashchange", render);
}

function render() {
  const route = parseHash();
  const name = route.name === "product" ? "/" : route.name;
  markNav(name);
  if (route.name === "product") renderProduct(main, route.id);
  else if (route.name === "/ranges") renderRanges(main);
  else if (route.name === "/about") renderAbout(main);
  else renderCatalogue(main);
  main.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "instant" });
}

boot();
