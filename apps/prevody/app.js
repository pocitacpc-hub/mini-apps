/* apps/prevody/app.js
 * Stabilní verze s tlačítkem "Přepočítat" a delegovaným zápisem do state.
 * - Změny v UI -> uloží se do state + označí se "dirty"
 * - Přepočítat -> render()
 * - Export XLSX (SheetJS) + graf + tabulky
 */

const CFG_IDS = ["A", "B", "C", "D"];
const CFG_COLORS = { A: "#6ee7ff", B: "#b6ff6e", C: "#ffb86e", D: "#d46eff" };

const DEFAULTS = {
  name: "",
  enabled: true,

  drivetrain: "1x",        // "1x" | "2x"
  wheelId: "700x28",
  useCustomCirc: false,
  customCircMm: 2136,

  ring1x: 40,
  ring2xSmall: 34,
  ring2xBig: 50,

  cassetteId: "10-46-12s",

  cadence: 80,             // used if cadencePerConfig
  crossMode: "standard",   // aggressive|standard|conservative|advanced

  // Advanced N settings (BAD zone)
  adv_2x_bigRing_largestCogsBad: 2,
  adv_2x_smallRing_smallestCogsBad: 2,
  adv_1x_smallestCogsBad: 1,
  adv_1x_largestCogsBad: 1
};

const CROSS_PRESETS = {
  aggressive: { n2x: 1, n1x: 1 },
  standard: { n2x: 2, n1x: 1 },
  conservative: { n2x: 3, n1x: 2 }
};

let DATA = null;

const state = {
  graphMode: "speed", // speed|gearInches
  show: { speed: true, ratio: false, dev: false, gi: false },
  filterOnlyOk: false,
  cadencePerConfig: false,
  cadenceGlobal: 80,

  dirty: false,
  configs: {}
};

/* ---------------- utils ---------------- */

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
function byId(arr, id) { return arr.find(x => x.id === id); }
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    "\"": "&quot;", "'": "&#39;"
  }[s]));
}
function fmt(n, d = 1) {
  if (!Number.isFinite(n)) return "–";
  return n.toFixed(d);
}

function markDirty(isDirty = true) {
  state.dirty = isDirty;
  const btn = document.getElementById("recalc");
  if (!btn) return;
  btn.classList.toggle("primary", isDirty);
  btn.textContent = isDirty ? "Přepočítat *" : "Přepočítat";
}

/* ---------------- data ---------------- */

async function loadData() {
  const res = await fetch("./data.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Nepodařilo se načíst data.json. (Spusť přes lokální server / zkontroluj cestu.)");
  return res.json();
}

function initState() {
  for (const id of CFG_IDS) {
    const base = deepClone(DEFAULTS);
    base.enabled = (id === "A" || id === "B"); // default A+B on
    base.name = id === "A" ? "Setup A" : id === "B" ? "Setup B" : `Setup ${id}`;
    state.configs[id] = base;
  }
}

/* ---------------- computations ---------------- */

function wheelCircMm(cfg) {
  const w = byId(DATA.wheels, cfg.wheelId);
  if (!w) return Number(cfg.customCircMm || 2100);
  return cfg.useCustomCirc ? Number(cfg.customCircMm || w.circumference_mm) : w.circumference_mm;
}

function wheelDiameterIn(cfg) {
  const w = byId(DATA.wheels, cfg.wheelId);
  if (w && !cfg.useCustomCirc) return w.diameter_in;
  const circMm = wheelCircMm(cfg);
  const dMm = circMm / Math.PI;
  return dMm / 25.4;
}

function getCogs(cfg) {
  const cas = byId(DATA.cassettes, cfg.cassetteId);
  return cas ? cas.cogs.slice() : [];
}

// cogIndex is index in cogs array (0 smallest -> last largest)
function crossStatus(cfg, ringIndex, cogIndex, cogsCount, drivetrain) {
  const mode = cfg.crossMode;
  let n2x = CROSS_PRESETS.standard.n2x;
  let n1x = CROSS_PRESETS.standard.n1x;

  if (mode !== "advanced") {
    const preset = CROSS_PRESETS[mode] || CROSS_PRESETS.standard;
    n2x = preset.n2x;
    n1x = preset.n1x;
  }

  const warnPad = 1; // one cog next to BAD is WARN
  const last = cogsCount - 1;

  if (drivetrain === "2x") {
    const badBigLargest = mode === "advanced"
      ? Number(cfg.adv_2x_bigRing_largestCogsBad || 0)
      : n2x;

    const badSmallSmallest = mode === "advanced"
      ? Number(cfg.adv_2x_smallRing_smallestCogsBad || 0)
      : n2x;

    // big ring: avoid largest cogs (end of array)
    if (ringIndex === 1) {
      if (badBigLargest > 0 && cogIndex >= last - (badBigLargest - 1)) return "bad";
      if (badBigLargest > 0 && cogIndex >= last - (badBigLargest - 1) - warnPad) return "warn";
      return "ok";
    }
    // small ring: avoid smallest cogs (start of array)
    if (ringIndex === 0) {
      if (badSmallSmallest > 0 && cogIndex <= (badSmallSmallest - 1)) return "bad";
      if (badSmallSmallest > 0 && cogIndex <= (badSmallSmallest - 1) + warnPad) return "warn";
      return "ok";
    }
    return "ok";
  }

  // 1x
  const badSmallest = mode === "advanced"
    ? Number(cfg.adv_1x_smallestCogsBad || 0)
    : n1x;

  const badLargest = mode === "advanced"
    ? Number(cfg.adv_1x_largestCogsBad || 0)
    : n1x;

  if (badSmallest > 0 && cogIndex <= badSmallest - 1) return "bad";
  if (badSmallest > 0 && cogIndex <= (badSmallest - 1) + warnPad) return "warn";

  if (badLargest > 0 && cogIndex >= last - (badLargest - 1)) return "bad";
  if (badLargest > 0 && cogIndex >= last - (badLargest - 1) - warnPad) return "warn";

  return "ok";
}

function computeCombos(cfg) {
  const cogs = getCogs(cfg);
  const circM = wheelCircMm(cfg) / 1000;
  const diamIn = wheelDiameterIn(cfg);
  const cadence = state.cadencePerConfig ? Number(cfg.cadence || 80) : Number(state.cadenceGlobal || 80);

  const rings = (cfg.drivetrain === "2x")
    ? [Number(cfg.ring2xSmall), Number(cfg.ring2xBig)]
    : [Number(cfg.ring1x)];

  const rows = rings.map((ringTeeth, ringIdx) => {
    const cells = cogs.map((cogTeeth, cogIdx) => {
      const ratio = ringTeeth / cogTeeth;
      const development_m = ratio * circM;
      const speed_kmh = (development_m * cadence * 60) / 1000;
      const gear_inches = diamIn * ratio;
      const status = crossStatus(cfg, ringIdx, cogIdx, cogs.length, cfg.drivetrain);
      return { ringTeeth, cogTeeth, ratio, development_m, speed_kmh, gear_inches, status, ringIdx, cogIdx };
    });
    return { ringTeeth, ringIdx, cells };
  });

  const all = rows.flatMap(r => r.cells);
  const ratios = all.map(x => x.ratio);
  const speeds = all.map(x => x.speed_kmh);

  const minRatio = Math.min(...ratios);
  const maxRatio = Math.max(...ratios);
  const rangePct = (maxRatio / minRatio) * 100;

  return {
    cadence, circM, diamIn, cogs, rings, rows,
    summary: {
      minSpeed: Math.min(...speeds),
      maxSpeed: Math.max(...speeds),
      minRatio, maxRatio, rangePct
    }
  };
}

/* ---------------- DOM helpers ---------------- */

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (v === null || v === undefined) continue;
    else node.setAttribute(k, String(v));
  }
  for (const ch of children) {
    if (typeof ch === "string") node.appendChild(document.createTextNode(ch));
    else if (ch) node.appendChild(ch);
  }
  return node;
}

/* ---------------- rendering ---------------- */

function buildConfigCard(id) {
  const cfg = state.configs[id];
  const dotClass = id === "A" ? "" : id.toLowerCase();

  const head = el("div", { class: "config-head" }, [
    el("div", {}, [
      el("div", { class: "badge" }, [
        el("span", { class: `badge-dot ${dotClass}` }),
        el("span", {}, [`Konfigurace ${id}`])
      ]),
      el("small", {}, ["Převody + rychlosti + křížení"])
    ]),

    el("div", { class: "head-actions" }, [
      el("label", { class: "toggle" }, [
        el("input", {
          type: "checkbox",
          "data-field": "enabled",
          ...(cfg.enabled ? { checked: "" } : {})
        }),
        el("span", {}, ["Aktivní"])
      ]),
      el("button", { class: "icon-btn", "data-action": "duplicate", "data-from": id }, ["Duplikovat"]),
      el("button", { class: "icon-btn", "data-action": "reset", "data-id": id }, ["Reset"])
    ])
  ]);

  const body = el("div", { class: "config-body" }, [
    buildConfigForm(id),
    el("div", { class: "summary", id: `summary-${id}` }),
    el("div", { class: "table-wrap", id: `tableWrap-${id}` })
  ]);

  // IMPORTANT: data-cfg for delegated binding
  return el("div", { class: "config-card", "data-cfg": id }, [head, body]);
}

function buildConfigForm(id) {
  const cfg = state.configs[id];

  const wheelOpts = DATA.wheels.map(w =>
    el("option", { value: w.id, ...(w.id === cfg.wheelId ? { selected: "" } : {}) }, [`${w.label} · ${w.circumference_mm} mm`])
  );
  const cassetteOpts = DATA.cassettes.map(c =>
    el("option", { value: c.id, ...(c.id === cfg.cassetteId ? { selected: "" } : {}) }, [c.label])
  );
  const ring1xOpts = DATA.chainrings_1x.map(r =>
    el("option", { value: r, ...(r === cfg.ring1x ? { selected: "" } : {}) }, [`${r}T`])
  );
  const crossModeOpts = [
    ["aggressive", "Agresivní (méně omezení)"],
    ["standard", "Standard"],
    ["conservative", "Konzervativní (víc omezení)"],
    ["advanced", "Advanced (ručně)"]
  ].map(([v, l]) => el("option", { value: v, ...(v === cfg.crossMode ? { selected: "" } : {}) }, [l]));

  const form = el("div", { class: "form" }, [
    el("div", { class: "field half" }, [
      el("label", {}, ["Název"]),
      el("input", { type: "text", value: cfg.name, "data-field": "name" })
    ]),

    el("div", { class: "field half" }, [
      el("label", {}, ["Pohon"]),
      el("div", { class: "inline" }, [
        el("label", { class: "radio" }, [
          el("input", {
            type: "radio",
            name: `drive-${id}`,
            value: "1x",
            "data-field": "drivetrain",
            ...(cfg.drivetrain === "1x" ? { checked: "" } : {})
          }),
          el("span", {}, ["1x"])
        ]),
        el("label", { class: "radio" }, [
          el("input", {
            type: "radio",
            name: `drive-${id}`,
            value: "2x",
            "data-field": "drivetrain",
            ...(cfg.drivetrain === "2x" ? { checked: "" } : {})
          }),
          el("span", {}, ["2x"])
        ])
      ])
    ]),

    el("div", { class: "field half" }, [
      el("label", {}, ["Kolo"]),
      el("select", { "data-field": "wheelId" }, wheelOpts)
    ]),

    el("div", { class: "field half" }, [
      el("label", {}, ["Obvod (mm)"]),
      el("div", { class: "inline" }, [
        el("label", { class: "toggle" }, [
          el("input", {
            type: "checkbox",
            "data-field": "useCustomCirc",
            ...(cfg.useCustomCirc ? { checked: "" } : {})
          }),
          el("span", {}, ["Vlastní obvod"])
        ]),
        el("input", {
          type: "number",
          min: "1000",
          max: "4000",
          step: "1",
          value: cfg.customCircMm,
          "data-field": "customCircMm",
          disabled: cfg.useCustomCirc ? null : ""
        })
      ])
    ]),

    el("div", { class: "field half" }, [
      el("label", {}, ["Kazeta"]),
      el("select", { "data-field": "cassetteId" }, cassetteOpts)
    ]),

    el("div", { class: "field half" }, [
      el("label", {}, ["Křížení řetězu"]),
      el("select", { "data-field": "crossMode" }, crossModeOpts)
    ])
  ]);

  // drivetrain specific fields
  if (cfg.drivetrain === "1x") {
    form.appendChild(el("div", { class: "field half" }, [
      el("label", {}, ["Převodník (1x)"]),
      el("select", { "data-field": "ring1x" }, ring1xOpts)
    ]));
  } else {
    form.appendChild(el("div", { class: "field half" }, [
      el("label", {}, ["Převodníky (2x)"]),
      el("div", { class: "inline" }, [
        el("input", { type: "number", min: "20", max: "70", step: "1", value: cfg.ring2xSmall, "data-field": "ring2xSmall" }),
        el("span", { class: "mini" }, ["malý"]),
        el("input", { type: "number", min: "20", max: "70", step: "1", value: cfg.ring2xBig, "data-field": "ring2xBig" }),
        el("span", { class: "mini" }, ["velký"])
      ])
    ]));
  }

  form.appendChild(el("div", { class: "field third" }, [
    el("label", {}, ["Kadence (rpm) – per konfigurace"]),
    el("input", {
      type: "number", min: "1", max: "250", step: "1",
      value: cfg.cadence,
      "data-field": "cadence",
      disabled: state.cadencePerConfig ? null : ""
    })
  ]));

  // advanced cross settings
  if (cfg.crossMode === "advanced") {
    form.appendChild(el("div", { class: "field" }, [
      el("label", {}, ["Advanced pravidla křížení (N)"]),
      el("div", { class: "inline" }, [
        el("span", { class: "mini" }, ["2x big ring + největší N:"]),
        el("input", { type: "number", min: "0", max: "6", step: "1", value: cfg.adv_2x_bigRing_largestCogsBad, "data-field": "adv_2x_bigRing_largestCogsBad" }),
        el("span", { class: "mini" }, ["2x small ring + nejmenší N:"]),
        el("input", { type: "number", min: "0", max: "6", step: "1", value: cfg.adv_2x_smallRing_smallestCogsBad, "data-field": "adv_2x_smallRing_smallestCogsBad" }),
        el("span", { class: "mini" }, ["1x nejmenší N:"]),
        el("input", { type: "number", min: "0", max: "6", step: "1", value: cfg.adv_1x_smallestCogsBad, "data-field": "adv_1x_smallestCogsBad" }),
        el("span", { class: "mini" }, ["1x největší N:"]),
        el("input", { type: "number", min: "0", max: "6", step: "1", value: cfg.adv_1x_largestCogsBad, "data-field": "adv_1x_largestCogsBad" })
      ])
    ]));
  }

  return form;
}

function buildSummary(id, calc) {
  const cfg = state.configs[id];
  const w = byId(DATA.wheels, cfg.wheelId);
  const cas = byId(DATA.cassettes, cfg.cassetteId);
  const s = calc.summary;

  const items = [
    { k: "Kadence", v: `${fmt(calc.cadence, 0)} rpm` },
    { k: "Kolo", v: `${w ? w.label : "–"} · ${fmt(wheelCircMm(cfg), 0)} mm` },
    { k: "Kazeta", v: `${cas ? cas.label : "–"}` },
    { k: "Rozsah", v: `${fmt(s.rangePct, 0)} %` },
    { k: "Min km/h", v: `${fmt(s.minSpeed, 1)}` },
    { k: "Max km/h", v: `${fmt(s.maxSpeed, 1)}` }
  ];

  const box = document.getElementById(`summary-${id}`);
  box.innerHTML = "";
  for (const it of items) {
    box.appendChild(el("div", { class: "kpi" }, [
      el("div", { class: "k" }, [it.k]),
      el("div", { class: "v" }, [it.v])
    ]));
  }
}

function buildTable(id, calc) {
  const cfg = state.configs[id];
  const cogs = calc.cogs;
  const rows = calc.rows;

  // Display columns: largest -> smallest (easy -> hard more intuitive)
  const colIndices = cogs.map((_, i) => i).reverse();

  const thead = el("thead", {}, [
    el("tr", {}, [
      el("th", {}, [cfg.drivetrain === "2x" ? "Převodník" : "1x převodník"]),
      ...colIndices.map(i => el("th", {}, [`${cogs[i]}T`]))
    ])
  ]);

  const tbody = el("tbody", {}, rows.map(r => {
    const ringLabel = cfg.drivetrain === "2x"
      ? (r.ringIdx === 0 ? `${r.ringTeeth}T (malý)` : `${r.ringTeeth}T (velký)`)
      : `${r.ringTeeth}T`;

    return el("tr", {}, [
      el("td", {}, [el("div", { class: "main" }, [ringLabel])]),
      ...colIndices.map(i => {
        const cell = r.cells[i];

        const parts = [];
        if (state.show.speed) parts.push({ lab: "km/h", val: fmt(cell.speed_kmh, 1) });
        if (state.show.ratio) parts.push({ lab: "ratio", val: fmt(cell.ratio, 3) });
        if (state.show.dev) parts.push({ lab: "m", val: fmt(cell.development_m, 2) });
        if (state.show.gi) parts.push({ lab: "GI", val: fmt(cell.gear_inches, 1) });

        const mainVal = state.show.speed ? `${fmt(cell.speed_kmh, 1)} km/h` : (parts[0]?.val ?? "–");
        const subParts = parts.filter(p => !(state.show.speed && p.lab === "km/h")).map(p => `${p.lab}: ${p.val}`);

        const status = cell.status;
        const statusLabel = status === "ok" ? "OK" : status === "warn" ? "Hraniční" : "Nevhodné";
        const dotClass = status === "ok" ? "dot" : status === "warn" ? "dot warn" : "dot bad";
        const tip = status === "ok"
          ? "Efektivní převod"
          : status === "warn"
            ? "Hraniční – zvýšené křížení řetězu"
            : "Nevhodné – výrazné křížení řetězu";

        return el("td", {}, [
          el("div", { class: `cell ${status}`, title: tip }, [
            el("div", { class: "tag" }, [
              el("span", { class: dotClass }),
              el("span", {}, [statusLabel])
            ]),
            el("div", { class: "main" }, [mainVal]),
            el("div", { class: "sub" }, subParts.map(x => el("span", {}, [x])))
          ])
        ]);
      })
    ]);
  }));

  const table = el("table", {}, [thead, tbody]);
  const wrap = document.getElementById(`tableWrap-${id}`);
  wrap.innerHTML = "";
  wrap.appendChild(table);
}

function renderConfigs() {
  const grid = document.getElementById("configGrid");
  grid.innerHTML = "";

  for (const id of CFG_IDS) {
    grid.appendChild(buildConfigCard(id));
  }

  for (const id of CFG_IDS) {
    const cfg = state.configs[id];
    if (!cfg.enabled) {
      const s = document.getElementById(`summary-${id}`);
      const t = document.getElementById(`tableWrap-${id}`);
      if (s) s.innerHTML = "";
      if (t) t.innerHTML = "";
      continue;
    }
    const calc = computeCombos(cfg);
    buildSummary(id, calc);
    buildTable(id, calc);
  }
}

function activeConfigs() {
  return CFG_IDS.filter(id => state.configs[id].enabled);
}

function buildChartLegend(ids) {
  const box = document.getElementById("chartLegend");
  box.innerHTML = ids.map(id => {
    const name = state.configs[id].name || id;
    return `<div class="legend-item">
      <span class="legend-line" style="background:${CFG_COLORS[id]};"></span>
      <span class="legend-dot" style="background:${CFG_COLORS[id]};"></span>
      <span>${id}: ${escapeHtml(name)}</span>
    </div>`;
  }).join("");
}

function drawCompareChart() {
  const canvas = document.getElementById("compareChart");
  const ctx = canvas.getContext("2d");

  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const ids = activeConfigs();
  buildChartLegend(ids);

  if (ids.length === 0) {
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = "14px system-ui";
    ctx.fillText("Žádná aktivní konfigurace.", 16, 24);
    return;
  }

  const series = ids.map(id => {
    const cfg = state.configs[id];
    const calc = computeCombos(cfg);
    let pts = calc.rows.flatMap(r => r.cells.map(c => ({
      x: c.ratio,
      y: state.graphMode === "speed" ? c.speed_kmh : c.gear_inches,
      status: c.status
    })));
    pts.sort((a, b) => a.x - b.x);
    if (state.filterOnlyOk) pts = pts.filter(p => p.status === "ok");
    return { id, pts };
  });

  const allPts = series.flatMap(s => s.pts);
  if (allPts.length === 0) {
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = "14px system-ui";
    ctx.fillText("Po filtrování nezbyly žádné body.", 16, 24);
    return;
  }

  const xmin = Math.min(...allPts.map(p => p.x));
  const xmax = Math.max(...allPts.map(p => p.x));
  const ymin = Math.min(...allPts.map(p => p.y));
  const ymax = Math.max(...allPts.map(p => p.y));

  const pad = { l: 50, r: 18, t: 18, b: 38 };
  const w = cssW - pad.l - pad.r;
  const h = cssH - pad.t - pad.b;

  const xToPx = x => pad.l + ((x - xmin) / (xmax - xmin || 1)) * w;
  const yToPx = y => pad.t + (1 - (y - ymin) / (ymax - ymin || 1)) * h;

  // grid
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 6; i++) {
    const x = pad.l + (i / 6) * w;
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + h); ctx.stroke();
  }
  for (let i = 0; i <= 5; i++) {
    const y = pad.t + (i / 5) * h;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + w, y); ctx.stroke();
  }

  // labels
  ctx.fillStyle = "rgba(255,255,255,0.60)";
  ctx.font = "12px system-ui";
  const yLabel = state.graphMode === "speed" ? "km/h" : "gear inches";
  ctx.fillText("ratio →", pad.l + w - 44, pad.t + h + 28);
  ctx.fillText(yLabel, 10, pad.t + 12);

  // plot
  for (const s of series) {
    const color = CFG_COLORS[s.id];

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    ctx.beginPath();
    s.pts.forEach((p, idx) => {
      const x = xToPx(p.x);
      const y = yToPx(p.y);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    for (const p of s.pts) {
      const x = xToPx(p.x);
      const y = yToPx(p.y);

      ctx.fillStyle = color;

      if (p.status === "ok") {
        ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.fill();
      } else if (p.status === "warn") {
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(x, y, 4.4, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(255,209,102,0.65)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 6.2, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(x, y, 4.8, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(255,77,109,0.70)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 7.0, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  // frame
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  ctx.strokeRect(pad.l, pad.t, w, h);
}

function render() {
  // sync global cadence input
  const cad = document.getElementById("cadenceGlobal");
  if (cad) cad.value = state.cadenceGlobal;

  renderConfigs();
  drawCompareChart();
}

/* ---------------- events (top) ---------------- */

function wireTopControls() {
  // cadence chips
  document.querySelectorAll(".chip").forEach(btn => {
    btn.addEventListener("click", () => {
      state.cadenceGlobal = Number(btn.dataset.cad);
      markDirty(true);
    });
  });

  // cadence global input
  const cad = document.getElementById("cadenceGlobal");
  if (cad) {
    cad.addEventListener("input", (e) => {
      state.cadenceGlobal = Number(e.target.value || 80);
      markDirty(true);
    });
  }

  // cadence per config
  const cpc = document.getElementById("cadencePerConfig");
  if (cpc) {
    cpc.addEventListener("change", (e) => {
      state.cadencePerConfig = e.target.checked;
      markDirty(true);
    });
  }

  // graph mode
  document.querySelectorAll(".seg-btn[data-graph]").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".seg-btn[data-graph]").forEach(x => x.classList.remove("is-active"));
      b.classList.add("is-active");
      state.graphMode = b.dataset.graph;
      markDirty(true);
    });
  });

  // show toggles
  const bindCheck = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", (e) => {
      state.show[key] = e.target.checked;
      markDirty(true);
    });
  };
  bindCheck("showSpeed", "speed");
  bindCheck("showRatio", "ratio");
  bindCheck("showDev", "dev");
  bindCheck("showGI", "gi");

  // filter only ok
  const f = document.getElementById("filterOnlyOk");
  if (f) {
    f.addEventListener("change", (e) => {
      state.filterOnlyOk = e.target.checked;
      markDirty(true);
    });
  }

  // XLSX export
  const ex = document.getElementById("exportXlsx");
  if (ex) ex.addEventListener("click", exportXlsx);

  // responsive redraw after render
  window.addEventListener("resize", () => {
    // chart uses current canvas size; only redraw if we already rendered once
    if (!state.dirty) drawCompareChart();
  });
}

/* ---------------- delegated config binding ---------------- */

function parseFieldValue(el) {
  if (el.type === "checkbox") return el.checked;
  if (el.type === "number") return el.value === "" ? "" : Number(el.value);
  // radios: return el.value
  return el.value;
}

function normalizeCfgAfterField(cfg, field) {
  // Keep some constraints sane
  if (field === "ring2xSmall" || field === "ring2xBig") {
    cfg.ring2xSmall = Number(cfg.ring2xSmall || 34);
    cfg.ring2xBig = Number(cfg.ring2xBig || 50);
    if (cfg.ring2xBig <= cfg.ring2xSmall) cfg.ring2xBig = cfg.ring2xSmall + 1;
  }
  if (field === "customCircMm") {
    const v = Number(cfg.customCircMm || 0);
    if (Number.isFinite(v) && v > 0) cfg.customCircMm = v;
  }
}

function wireConfigDelegation() {
  const grid = document.getElementById("configGrid");
  if (!grid) return;

  const handle = (e) => {
    const target = e.target;

    // Buttons in config header
    if (target?.dataset?.action === "duplicate") {
      duplicateConfig(target.dataset.from);
      markDirty(true);
      return;
    }
    if (target?.dataset?.action === "reset") {
      resetConfig(target.dataset.id);
      markDirty(true);
      return;
    }

    const field = target?.dataset?.field;
    if (!field) return;

    const card = target.closest("[data-cfg]");
    if (!card) return;

    const id = card.dataset.cfg;
    const cfg = state.configs[id];
    if (!cfg) return;

    // enabled checkbox is inside header but still within card, so OK.
    const val = parseFieldValue(target);

    // radios need only react when checked
    if (target.type === "radio" && !target.checked) return;

    cfg[field] = val;

    // extra: changing wheelId should update customCircMm if not using custom
    if (field === "wheelId") {
      const w = byId(DATA.wheels, cfg.wheelId);
      if (w && !cfg.useCustomCirc) cfg.customCircMm = w.circumference_mm;
    }

    normalizeCfgAfterField(cfg, field);

    // If drivetrain changed, keep rings reasonable
    if (field === "drivetrain") {
      if (cfg.drivetrain === "1x") {
        cfg.crossMode = cfg.crossMode || "standard";
      } else {
        cfg.crossMode = cfg.crossMode || "standard";
      }
    }

    markDirty(true);
  };

  grid.addEventListener("click", handle);
  grid.addEventListener("input", handle);
  grid.addEventListener("change", handle);
}

/* ---------------- recalc button ---------------- */

function wireRecalcButton() {
  const btn = document.getElementById("recalc");
  if (!btn) return;
  btn.addEventListener("click", () => {
    markDirty(false);
    render();
  });
}

/* ---------------- config actions ---------------- */

function duplicateConfig(fromId) {
  const from = state.configs[fromId];
  if (!from) return;

  const copy = deepClone(from);
  copy.name = `${from.name} (copy)`;
  copy.enabled = true;

  const targetId = CFG_IDS.find(id => !state.configs[id].enabled);
  if (!targetId) {
    const idx = (CFG_IDS.indexOf(fromId) + 1) % CFG_IDS.length;
    state.configs[CFG_IDS[idx]] = copy;
  } else {
    state.configs[targetId] = copy;
  }
}

function resetConfig(id) {
  const wasEnabled = state.configs[id]?.enabled ?? true;
  state.configs[id] = deepClone(DEFAULTS);
  state.configs[id].enabled = wasEnabled;
  state.configs[id].name = `Setup ${id}`;
}

/* ---------------- export ---------------- */

function exportXlsx() {
  if (!window.XLSX) {
    alert("SheetJS (XLSX) se nenačetl.");
    return;
  }

  const wb = XLSX.utils.book_new();

  // Summary
  const summaryRows = [["Config","Name","Drivetrain","Wheel","Circ(mm)","Cassette","Cadence","Range(%)","Min km/h","Max km/h"]];
  for (const id of CFG_IDS) {
    const cfg = state.configs[id];
    if (!cfg.enabled) continue;
    const calc = computeCombos(cfg);
    const w = byId(DATA.wheels, cfg.wheelId);
    const cas = byId(DATA.cassettes, cfg.cassetteId);

    summaryRows.push([
      id,
      cfg.name,
      cfg.drivetrain,
      w ? w.label : cfg.wheelId,
      Math.round(wheelCircMm(cfg)),
      cas ? cas.label : cfg.cassetteId,
      calc.cadence,
      Number(calc.summary.rangePct.toFixed(0)),
      Number(calc.summary.minSpeed.toFixed(1)),
      Number(calc.summary.maxSpeed.toFixed(1))
    ]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "Summary");

  // Per config details
  for (const id of CFG_IDS) {
    const cfg = state.configs[id];
    if (!cfg.enabled) continue;
    const calc = computeCombos(cfg);

    const rows = [["Ring","Cog","Ratio","Development(m)","Gear inches","Speed(km/h)","Status"]];
    for (const r of calc.rows) {
      for (const c of r.cells) {
        rows.push([
          c.ringTeeth,
          c.cogTeeth,
          Number(c.ratio.toFixed(5)),
          Number(c.development_m.toFixed(4)),
          Number(c.gear_inches.toFixed(2)),
          Number(c.speed_kmh.toFixed(3)),
          c.status
        ]);
      }
    }

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), `Config ${id}`);
  }

  XLSX.writeFile(wb, `prevody_${new Date().toISOString().slice(0,10)}.xlsx`);
}

/* ---------------- main ---------------- */

(async function main(){
  // only run on app page
  if (!document.getElementById("configGrid")) return;

  initState();

  try {
    DATA = await loadData();
  } catch (e) {
    alert(e.message);
    throw e;
  }

  wireTopControls();
  wireConfigDelegation();
  wireRecalcButton();

  // initial render
  markDirty(false);
  render();
})();
