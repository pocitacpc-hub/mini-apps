(async function () {
  const grid = document.getElementById("appGrid");
  const err = document.getElementById("hubError");
  const search = document.getElementById("search");

  function showError(msg) {
    err.style.display = "block";
    err.textContent = msg;
  }

  function normalize(s) {
    return (s || "").toString().toLowerCase().trim();
  }

  function render(apps, q = "") {
    const query = normalize(q);

    const filtered = apps.filter(a => {
      if (!query) return true;
      const hay = [
        a.name, a.description, (a.tags || []).join(" "), a.id
      ].map(normalize).join(" ");
      return hay.includes(query);
    });

    grid.innerHTML = "";

    if (filtered.length === 0) {
      grid.appendChild(tileDisabled("Nic nenalezeno", "Zkus jiné hledání.", "🔎"));
      return;
    }

    for (const app of filtered) {
      const isDisabled = app.status !== "active" || !app.path;
      grid.appendChild(isDisabled ? tileDisabled(app.name, app.description, app.icon) : tileLink(app));
    }
  }

  function tileLink(app) {
    const a = document.createElement("a");
    a.className = "app-tile";
    a.href = app.path;

    a.innerHTML = `
      <div class="app-icon" aria-hidden="true">${escapeHtml(app.icon || "🧩")}</div>
      <div class="app-info">
        <div class="app-name">${escapeHtml(app.name || app.id)}</div>
        <div class="app-desc">${escapeHtml(app.description || "")}</div>
      </div>
      <div class="app-go" aria-hidden="true">→</div>
    `;
    return a;
  }

  function tileDisabled(name, desc, icon) {
    const d = document.createElement("div");
    d.className = "app-tile is-disabled";
    d.setAttribute("aria-disabled", "true");

    d.innerHTML = `
      <div class="app-icon" aria-hidden="true">${escapeHtml(icon || "⏳")}</div>
      <div class="app-info">
        <div class="app-name">${escapeHtml(name || "Aplikace")}</div>
        <div class="app-desc">${escapeHtml(desc || "")}</div>
      </div>
      <div class="app-go" aria-hidden="true">⏳</div>
    `;
    return d;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, s => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;",
      "\"": "&quot;", "'": "&#39;"
    }[s]));
  }

  // Load JSON
  let apps = [];
  try {
    const res = await fetch("apps/apps.json", { cache: "no-store" });
    if (!res.ok) throw new Error("Nepodařilo se načíst apps/apps.json. Spusť přes lokální server.");
    apps = await res.json();
    if (!Array.isArray(apps)) throw new Error("apps.json musí být pole objektů.");
  } catch (e) {
    showError(e.message);
    return;
  }

  render(apps);

  // Search
  search.addEventListener("input", () => render(apps, search.value));
})();
