import {
  artworkImage,
  isArtworkReference,
  type ArtworkAsset,
  type ArtworkKind,
} from "./artwork-model.js";
import { button, el, get } from "./dom.js";
import { pixelsPerTile } from "./project-constants.js";

const resultsPerPage = 48;

export function setupAssetPicker(
  selected: (asset: ArtworkAsset) => void,
  importArtwork: (data: FormData) => Promise<void>,
) {
  const dialog = get<HTMLDialogElement>("asset-picker");
  const browse = get("asset-browser");
  const search = get<HTMLInputElement>("asset-search");
  const kind = get<HTMLSelectElement>("asset-kind");
  const list = get("asset-results");
  const status = get("asset-results-status");
  const previous = get<HTMLButtonElement>("asset-previous");
  const next = get<HTMLButtonElement>("asset-next");
  const startImport = get<HTMLButtonElement>("open-asset-import");
  const showAll = get<HTMLButtonElement>("show-all-assets");
  const close = get<HTMLButtonElement>("close-asset-picker");
  const selection = get("asset-selection");
  const use = get<HTMLButtonElement>("use-selected-asset");
  const preview = get<HTMLImageElement>("selected-asset-image");
  const form = get<HTMLFormElement>("asset-import");
  const format = get<HTMLSelectElement>("asset-import-kind");
  const upload = get<HTMLInputElement>("asset-import-png");
  const metadata = get<HTMLInputElement>("asset-import-manifest");
  const filePreview = get<HTMLImageElement>("asset-import-preview");
  const fileDetails = get("asset-import-details");
  const importStatus = get("asset-import-status");
  const importError = get("asset-import-error");
  const submit = get<HTMLButtonElement>("asset-import-submit");
  const back = get<HTMLButtonElement>("back-to-assets");
  let assets: ArtworkAsset[] = [];
  let request: AbortController | undefined;
  let asset: ArtworkAsset | undefined;
  let recent: Set<string> | undefined;
  let page = 0;
  let importing = false;
  let placeable = true;
  let uploadURL: string | undefined;

  function showSelection(value?: ArtworkAsset) {
    asset = value;
    selection.hidden = !value;
    use.disabled = !value;
    use.hidden = !placeable;
    for (const item of list.querySelectorAll<HTMLButtonElement>("button[data-asset]")) {
      item.setAttribute("aria-pressed", String(item.dataset.asset === value?.id));
    }
    if (!value) return;
    preview.src = artworkImage(value.kind, value.id);
    get("selected-asset-name").textContent = value.name;
    get("selected-asset-size").textContent = `${value.width} × ${value.height} px`;
    use.textContent = value.kind === "tile" ? "Use tile" : "Use sprite";
  }

  function render() {
    const filter = search.value.trim().toLowerCase();
    const matches = assets.filter(
      (entry) =>
        (!recent || recent.has(entry.id)) &&
        entry.kind === kind.value &&
        `${entry.name} ${entry.id}`.toLowerCase().includes(filter),
    );
    const start = page * resultsPerPage;
    list.replaceChildren();
    for (const entry of matches.slice(start, start + resultsPerPage)) {
      const item = button("", () => showSelection(entry));
      item.dataset.asset = entry.id;
      item.title = `${entry.name} · ${entry.width} × ${entry.height} px`;
      const image = el("img");
      image.src = artworkImage(entry.kind, entry.id);
      image.alt = "";
      image.loading = "lazy";
      item.append(image, el("span", "", entry.name));
      list.append(item);
    }
    list.scrollTop = 0;
    showSelection();
    previous.disabled = page === 0;
    next.disabled = start + resultsPerPage >= matches.length;
    previous.hidden = next.hidden = matches.length <= resultsPerPage;
    showAll.hidden = !recent;
    status.textContent = matches.length
      ? `${start + 1}–${Math.min(start + resultsPerPage, matches.length)} of ${matches.length}${recent ? " imported" : ""}`
      : "No matching assets.";
  }

  async function loadAssets() {
    const response = await fetch("./api/artwork-assets", { signal: request?.signal });
    if (!response.ok) throw Error("Could not load the asset library.");
    const data: ArtworkAsset[] = await response.json();
    assets = data.filter(
      (entry) =>
        (entry.kind === "tile" || entry.kind === "sprite") &&
        isArtworkReference(entry.kind, entry.id),
    );
  }

  function resetResults() {
    page = 0;
    if (!request) render();
  }

  function updateImportFields() {
    const atlas = format.value === "gbc-atlas";
    get("asset-import-manifest-field").hidden = !atlas;
    metadata.required = atlas;
    get("asset-import-guidance").textContent = atlas
      ? "Choose the atlas PNG and its matching .atlas.json."
      : format.value === "tiles"
        ? "The sheet is split into 8×8 tiles."
        : "The whole PNG becomes one sprite.";
    updateFileDetails();
  }

  function updateFileDetails() {
    const width = filePreview.naturalWidth;
    const height = filePreview.naturalHeight;
    if (!uploadURL || !width || !height) return;
    const size = `${width} × ${height} px`;
    if (format.value !== "tiles") {
      fileDetails.textContent = size;
    } else if (width % pixelsPerTile || height % pixelsPerTile) {
      fileDetails.textContent = `${size} · Each dimension must be divisible by 8.`;
    } else {
      const count = (width / pixelsPerTile) * (height / pixelsPerTile);
      fileDetails.textContent = `${size} · ${count} ${count === 1 ? "tile" : "tiles"}`;
    }
  }

  function showImport(open: boolean) {
    form.hidden = !open;
    browse.hidden = open;
    if (open) {
      form.reset();
      upload.onchange?.(new Event("change"));
      importStatus.textContent = importError.textContent = "";
      updateImportFields();
      format.focus();
    } else {
      startImport.focus();
    }
  }

  search.oninput = kind.onchange = resetResults;
  previous.onclick = () => {
    page--;
    render();
  };
  next.onclick = () => {
    page++;
    render();
  };
  showAll.onclick = () => {
    recent = undefined;
    resetResults();
    search.focus();
  };
  use.onclick = () => {
    if (!asset) return;
    selected(asset);
    dialog.close();
  };
  startImport.onclick = () => showImport(true);
  back.onclick = () => showImport(false);
  close.onclick = () => dialog.close();
  dialog.oncancel = (event) => {
    if (importing) event.preventDefault();
  };
  dialog.onclose = () => {
    request?.abort();
    if (uploadURL) URL.revokeObjectURL(uploadURL);
    uploadURL = undefined;
    filePreview.removeAttribute("src");
  };
  format.onchange = updateImportFields;
  upload.onchange = () => {
    if (uploadURL) URL.revokeObjectURL(uploadURL);
    const file = upload.files?.[0];
    uploadURL = file && URL.createObjectURL(file);
    filePreview.parentElement?.toggleAttribute("hidden", !uploadURL);
    fileDetails.textContent = "";
    filePreview.removeAttribute("src");
    if (uploadURL) filePreview.src = uploadURL;
  };
  filePreview.onload = updateFileDetails;
  filePreview.onerror = () => {
    if (uploadURL) fileDetails.textContent = "Preview unavailable.";
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (importing) return;
    const earlier = new Set(assets.map((entry) => entry.id));
    const data = new FormData(form);
    importing = true;
    for (const control of [format, upload, metadata, submit, back]) control.disabled = true;
    importError.textContent = "";
    importStatus.textContent = "Importing artwork…";
    let saved = false;
    try {
      await importArtwork(data);
      saved = true;
      await loadAssets();
      const imports = assets.filter((entry) => !earlier.has(entry.id));
      recent = new Set(imports.map((entry) => entry.id));
      kind.value = imports.some((entry) => entry.kind === "tile") ? "tile" : "sprite";
      search.value = "";
      page = 0;
      showImport(false);
      render();
      if (imports.filter((entry) => entry.kind === kind.value).length === 1) {
        showSelection(imports.find((entry) => entry.kind === kind.value));
      }
    } catch (error) {
      if (saved) {
        showImport(false);
        status.textContent = "Artwork imported. Reopen the library to refresh its contents.";
      } else {
        importError.textContent = (error as Error).message;
      }
    } finally {
      importStatus.textContent = "";
      for (const control of [format, upload, metadata, submit, back]) control.disabled = false;
      importing = false;
    }
  };

  return async (initialKind: ArtworkKind, canPlace: boolean) => {
    request?.abort();
    const controller = new AbortController();
    request = controller;
    placeable = canPlace;
    recent = undefined;
    kind.value = initialKind;
    search.value = "";
    page = 0;
    list.replaceChildren();
    showSelection();
    previous.disabled = next.disabled = startImport.disabled = true;
    previous.hidden = next.hidden = true;
    showAll.hidden = true;
    status.textContent = "Loading assets…";
    browse.hidden = false;
    form.hidden = true;
    dialog.showModal();
    search.focus();
    try {
      await loadAssets();
      if (request === controller && !controller.signal.aborted) render();
    } catch (error) {
      if (!controller.signal.aborted) status.textContent = (error as Error).message;
    } finally {
      if (request === controller) {
        request = undefined;
        startImport.disabled = false;
      }
    }
  };
}
