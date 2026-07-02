const categories = [
  { id: "deep-work", label: "Deep Work" },
  { id: "admin", label: "Admin" },
  { id: "meeting", label: "Meeting" },
  { id: "ops", label: "Ops" },
  { id: "health", label: "Health" },
  { id: "family", label: "Family" },
  { id: "noise", label: "Noise" },
  { id: "recovery", label: "Recovery" },
];

const storageKey = "timeblock-reality-v1";
const state = loadState();
let deferredInstallPrompt = null;

const els = {
  activeTitle: document.querySelector("#activeTitle"),
  endBlockButton: document.querySelector("#endBlockButton"),
  quickGrid: document.querySelector("#quickGrid"),
  manualForm: document.querySelector("#manualForm"),
  manualCategory: document.querySelector("#manualCategory"),
  manualStart: document.querySelector("#manualStart"),
  manualEnd: document.querySelector("#manualEnd"),
  manualNote: document.querySelector("#manualNote"),
  planForm: document.querySelector("#planForm"),
  planCategory: document.querySelector("#planCategory"),
  planStart: document.querySelector("#planStart"),
  planEnd: document.querySelector("#planEnd"),
  addPlanButton: document.querySelector("#addPlanButton"),
  planList: document.querySelector("#planList"),
  actualList: document.querySelector("#actualList"),
  metricsGrid: document.querySelector("#metricsGrid"),
  reviewRows: document.querySelector("#reviewRows"),
  exportButton: document.querySelector("#exportButton"),
  exportText: document.querySelector("#exportText"),
  resetButton: document.querySelector("#resetButton"),
  todayLabel: document.querySelector("#todayLabel"),
  installButton: document.querySelector("#installButton"),
  blockTemplate: document.querySelector("#blockTemplate"),
};

init();

function init() {
  fillSelect(els.manualCategory);
  fillSelect(els.planCategory);
  renderQuickButtons();
  setDefaultTimes();
  bindEvents();
  render();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => activateTab(tab.dataset.tab));
  });

  els.endBlockButton.addEventListener("click", endActiveBlock);
  els.manualForm.addEventListener("submit", addManualActual);
  els.planForm.addEventListener("submit", addPlanBlock);
  els.addPlanButton.addEventListener("click", () => {
    els.planForm.hidden = !els.planForm.hidden;
  });
  els.exportButton.addEventListener("click", exportMarkdown);
  els.resetButton.addEventListener("click", resetLocalData);
  els.installButton.addEventListener("click", installApp);

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    els.installButton.hidden = false;
  });
}

function activateTab(tabName) {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.tab === tabName);
  });
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("is-active", panel.id === `${tabName}Panel`);
  });
}

function renderQuickButtons() {
  els.quickGrid.innerHTML = "";
  categories.slice(0, 8).forEach((category) => {
    const button = document.createElement("button");
    button.className = "primary-button";
    button.type = "button";
    button.textContent = category.label;
    button.addEventListener("click", () => startQuickBlock(category.id));
    els.quickGrid.append(button);
  });
}

function fillSelect(select) {
  select.innerHTML = "";
  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.label;
    select.append(option);
  });
}

function setDefaultTimes() {
  const now = new Date();
  els.todayLabel.textContent = now.toLocaleDateString("th-TH", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  els.manualStart.value = toTimeInput(roundDate(now, 15));
  els.manualEnd.value = toTimeInput(addMinutes(roundDate(now, 15), 30));
  els.planStart.value = "09:00";
  els.planEnd.value = "10:30";
}

function startQuickBlock(categoryId) {
  if (state.active) endActiveBlock(false);
  state.active = {
    id: crypto.randomUUID(),
    categoryId,
    start: new Date().toISOString(),
  };
  saveState();
  render();
}

function endActiveBlock(shouldRender = true) {
  if (!state.active) return;
  const end = new Date();
  const start = new Date(state.active.start);
  if (end.getTime() - start.getTime() < 60 * 1000) {
    end.setMinutes(end.getMinutes() + 5);
  }
  state.actual.push({
    id: state.active.id,
    categoryId: state.active.categoryId,
    note: "",
    start: state.active.start,
    end: end.toISOString(),
  });
  state.active = null;
  saveState();
  if (shouldRender) render();
}

function addManualActual(event) {
  event.preventDefault();
  const block = buildBlockFromForm("actual", els.manualCategory.value, els.manualStart.value, els.manualEnd.value, els.manualNote.value);
  state.actual.push(block);
  els.manualNote.value = "";
  saveState();
  render();
}

function addPlanBlock(event) {
  event.preventDefault();
  const block = buildBlockFromForm("plan", els.planCategory.value, els.planStart.value, els.planEnd.value, "");
  state.plan.push(block);
  els.planForm.hidden = true;
  saveState();
  render();
}

function buildBlockFromForm(prefix, categoryId, startTime, endTime, note) {
  const day = todayDateKey();
  const start = fromDateAndTime(day, startTime);
  let end = fromDateAndTime(day, endTime);
  if (end <= start) end = addMinutes(start, 30);
  return {
    id: `${prefix}-${crypto.randomUUID()}`,
    categoryId,
    note: note.trim(),
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function render() {
  renderActive();
  renderBlocks("plan", els.planList);
  renderBlocks("actual", els.actualList);
  renderReview();
}

function renderActive() {
  if (!state.active) {
    els.activeTitle.textContent = "No active block";
    els.endBlockButton.disabled = true;
  } else {
    els.activeTitle.textContent = `${categoryLabel(state.active.categoryId)} since ${formatTime(state.active.start)}`;
    els.endBlockButton.disabled = false;
  }

  document.querySelectorAll(".quick-grid button").forEach((button, index) => {
    button.classList.toggle("active", state.active?.categoryId === categories[index].id);
  });
}

function renderBlocks(type, container) {
  const todayBlocks = state[type]
    .filter((block) => dateKey(block.start) === todayDateKey())
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  container.innerHTML = "";
  if (todayBlocks.length === 0) {
    const empty = document.createElement("p");
    empty.className = "block-time";
    empty.textContent = "No blocks";
    container.append(empty);
    return;
  }

  todayBlocks.forEach((block) => {
    const node = els.blockTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".block-title").textContent = categoryLabel(block.categoryId);
    node.querySelector(".block-time").textContent = `${formatTime(block.start)}-${formatTime(block.end)} · ${minutesBetween(block.start, block.end)}m`;
    const calendarLink = node.querySelector(".calendar-link");
    calendarLink.href = googleCalendarUrl(block, type);
    calendarLink.hidden = type !== "actual";
    node.querySelector(".delete-button").addEventListener("click", () => deleteBlock(type, block.id));
    container.append(node);
  });
}

function renderReview() {
  const start = startOfWeek(new Date());
  const end = addDays(start, 7);
  const planMinutes = totalMinutes(state.plan, start, end);
  const actualMinutes = totalMinutes(state.actual, start, end);
  const noiseMinutes = totalMinutes(state.actual.filter((block) => block.categoryId === "noise"), start, end);
  const recoveryMinutes = totalMinutes(state.actual.filter((block) => block.categoryId === "recovery"), start, end);
  const adherence = planMinutes ? Math.round((Math.min(planMinutes, actualMinutes) / planMinutes) * 100) : 0;

  els.metricsGrid.innerHTML = "";
  [
    ["Plan", formatHours(planMinutes)],
    ["Actual", formatHours(actualMinutes)],
    ["Adherence", `${adherence}%`],
    ["Noise", formatHours(noiseMinutes)],
    ["Recovery", formatHours(recoveryMinutes)],
  ].forEach(([label, value]) => {
    const card = document.createElement("div");
    card.innerHTML = `<span class="label">${label}</span><strong>${value}</strong>`;
    els.metricsGrid.append(card);
  });

  els.reviewRows.innerHTML = "";
  categories.forEach((category) => {
    const planned = totalMinutes(state.plan.filter((block) => block.categoryId === category.id), start, end);
    const actual = totalMinutes(state.actual.filter((block) => block.categoryId === category.id), start, end);
    if (!planned && !actual) return;
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${category.label}</td>
      <td>${formatHours(planned)}</td>
      <td>${formatHours(actual)}</td>
      <td>${formatSignedHours(actual - planned)}</td>
    `;
    els.reviewRows.append(row);
  });
}

function deleteBlock(type, id) {
  state[type] = state[type].filter((block) => block.id !== id);
  saveState();
  render();
}

function exportMarkdown() {
  const start = startOfWeek(new Date());
  const end = addDays(start, 7);
  const lines = [
    `# TimeBlock Review ${dateKey(start)} to ${dateKey(addDays(end, -1))}`,
    "",
    "## Summary",
    `- Plan: ${formatHours(totalMinutes(state.plan, start, end))}`,
    `- Actual: ${formatHours(totalMinutes(state.actual, start, end))}`,
    `- Noise: ${formatHours(totalMinutes(state.actual.filter((block) => block.categoryId === "noise"), start, end))}`,
    "",
    "## Category Delta",
    "| Category | Plan | Actual | Delta |",
    "|---|---:|---:|---:|",
  ];

  categories.forEach((category) => {
    const planned = totalMinutes(state.plan.filter((block) => block.categoryId === category.id), start, end);
    const actual = totalMinutes(state.actual.filter((block) => block.categoryId === category.id), start, end);
    if (planned || actual) {
      lines.push(`| ${category.label} | ${formatHours(planned)} | ${formatHours(actual)} | ${formatSignedHours(actual - planned)} |`);
    }
  });

  lines.push("", "## Notes", "- ");
  els.exportText.hidden = false;
  els.exportText.value = lines.join("\n");
  els.exportText.select();
  navigator.clipboard?.writeText(els.exportText.value).catch(() => {});
}

function resetLocalData() {
  if (!confirm("Reset data on this device?")) return;
  localStorage.removeItem(storageKey);
  state.plan = [];
  state.actual = [];
  state.active = null;
  saveState();
  render();
}

function installApp() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  deferredInstallPrompt = null;
  els.installButton.hidden = true;
}

function googleCalendarUrl(block, type) {
  const title = `${type === "actual" ? "Actual" : "Plan"}: ${categoryLabel(block.categoryId)}`;
  const details = block.note || "Logged from TimeBlock Reality";
  const dates = `${toGoogleDate(block.start)}/${toGoogleDate(block.end)}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates,
    details,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(storageKey)) || { plan: [], actual: [], active: null };
  } catch {
    return { plan: [], actual: [], active: null };
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function categoryLabel(id) {
  return categories.find((category) => category.id === id)?.label || id;
}

function todayDateKey() {
  return dateKey(new Date());
}

function dateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function fromDateAndTime(day, time) {
  return new Date(`${day}T${time}:00`);
}

function toTimeInput(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

function minutesBetween(start, end) {
  return Math.max(0, Math.round((new Date(end) - new Date(start)) / 60000));
}

function totalMinutes(blocks, start, end) {
  return blocks
    .filter((block) => new Date(block.start) >= start && new Date(block.start) < end)
    .reduce((sum, block) => sum + minutesBetween(block.start, block.end), 0);
}

function formatHours(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatSignedHours(minutes) {
  const sign = minutes > 0 ? "+" : "";
  return `${sign}${formatHours(minutes)}`;
}

function roundDate(date, stepMinutes) {
  const rounded = new Date(date);
  const ms = stepMinutes * 60 * 1000;
  return new Date(Math.round(rounded.getTime() / ms) * ms);
}

function addMinutes(date, minutes) {
  const next = new Date(date);
  next.setMinutes(next.getMinutes() + minutes);
  return next;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date) {
  const current = new Date(date);
  const day = current.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  current.setHours(0, 0, 0, 0);
  current.setDate(current.getDate() + diff);
  return current;
}

function toGoogleDate(value) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
