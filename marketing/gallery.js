const grid = document.querySelector("#asset-grid");
const filters = document.querySelector("#filters");
const search = document.querySelector("#search");
const resultNote = document.querySelector("#result-note");
const count = document.querySelector("#asset-count");

const state = { family: "all", query: "", outputs: [] };
const labels = {
  all: "All",
  carousel: "Carousel",
  landscape: "Feature cards",
  social: "Social",
  brand: "Channel art",
  "one-pager": "One-pagers",
};

const titleCase = (value) => value
  .replace(/-public(?:-|$)/g, " ")
  .replace(/\b\d{3,4}x\d{3,4}\b/g, "")
  .replace(/[-_]+/g, " ")
  .replace(/\b\w/g, (letter) => letter.toUpperCase())
  .replace(/\s+/g, " ")
  .trim();

const bytes = (value) => value < 1024 * 1024
  ? `${Math.round(value / 1024)} KB`
  : `${(value / 1024 / 1024).toFixed(1)} MB`;

const dimensions = (output) => output.width
  ? `${output.width} × ${output.height}`
  : `${output.media} / ${output.pages} page`;

function renderFilters() {
  const families = ["all", ...new Set(state.outputs.map(({ family }) => family))];
  filters.replaceChildren(...families.map((family) => {
    const button = document.createElement("button");
    const familyCount = family === "all" ? state.outputs.length : state.outputs.filter((output) => output.family === family).length;
    button.className = "filter-button";
    button.type = "button";
    button.dataset.family = family;
    button.setAttribute("aria-pressed", String(state.family === family));
    button.textContent = `${labels[family] ?? titleCase(family)} ${familyCount}`;
    button.addEventListener("click", () => {
      state.family = family;
      renderFilters();
      renderGrid();
    });
    return button;
  }));
}

function assetCard(output) {
  const article = document.createElement("article");
  article.className = "asset-card";
  const previewOutput = state.outputs
    .filter((candidate) => candidate.format === "PNG" && candidate.conceptId === output.conceptId)
    .sort((a, b) => (a.width * a.height) - (b.width * b.height))[0] ?? output;

  const preview = output.format === "PNG"
    ? `<img src="${previewOutput.file}" alt="${output.alt}" width="${previewOutput.width}" height="${previewOutput.height}" loading="lazy" decoding="async">`
    : `<div class="pdf-preview" aria-hidden="true">PDF</div>`;

  article.innerHTML = `
    <a class="asset-preview" href="${output.file}" aria-label="Open ${output.alt}">${preview}</a>
    <div class="asset-body">
      <div class="asset-meta"><span>${labels[output.family] ?? output.family}</span><span>${dimensions(output)} / ${bytes(output.bytes)}</span></div>
      <h3>${titleCase(output.id)}</h3>
      <div class="asset-links">
        <a href="${output.file}">Open original</a>
        <a href="${output.file}" download>Save file</a>
      </div>
    </div>`;
  return article;
}

function renderGrid() {
  const query = state.query.toLowerCase();
  const visible = state.outputs.filter((output) => {
    const inFamily = state.family === "all" || output.family === state.family;
    const haystack = `${output.id} ${output.family} ${output.layout} ${output.alt} ${output.width ?? ""} ${output.height ?? ""}`.toLowerCase();
    return inFamily && haystack.includes(query);
  });

  resultNote.textContent = `${visible.length} of ${state.outputs.length} verified assets shown.`;
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "empty-panel";
    empty.textContent = "No assets match this filter. Clear the search or choose another surface.";
    grid.replaceChildren(empty);
    return;
  }
  grid.replaceChildren(...visible.map(assetCard));
}

search.addEventListener("input", () => {
  state.query = search.value.trim();
  renderGrid();
});

try {
  const response = await fetch("manifest.json");
  if (!response.ok) throw new Error(`Manifest request returned ${response.status}.`);
  const manifest = await response.json();
  state.outputs = manifest.outputs;
  count.textContent = manifest.outputCount;
  renderFilters();
  renderGrid();
} catch (error) {
  resultNote.textContent = "The verified manifest could not be loaded.";
  const panel = document.createElement("p");
  panel.className = "error-panel";
  panel.textContent = `Gallery error: ${error.message}`;
  grid.replaceChildren(panel);
}
