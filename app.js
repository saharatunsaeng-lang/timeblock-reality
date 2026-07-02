const categories = [
  { id: "bd", code: "1 BD", name: "Body & Diet" },
  { id: "sp", code: "2 SP", name: "Spiritual & Purpose" },
  { id: "mm", code: "3 MM", name: "Mind & Memory" },
  { id: "rs", code: "4 RS", name: "Relationships & Social" },
  { id: "cm", code: "5 CM", name: "Career & Money" },
  { id: "fn", code: "6 FN", name: "Finance & Numbers" },
  { id: "ct", code: "7 CT", name: "Contribute" },
  { id: "ls", code: "8 LS", name: "Lifestyle" },
];

const storageKey = "timeblock-reality-v2";
const googleClientId = "809951458535-dg6gjp5nk4fjrgs1kngrger4cni90er9.apps.googleusercontent.com";
const googleScopes = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");
const actualCalendarNames = ["Actual-Time Log", "Actual - Time Log"];
const planMarkerCalendarNames = ["Plan-Week", "Plan - Week"];
const state = loadState();
let deferredInstallPrompt = null;
let tokenClient = null;
let googleAccessToken = "";
let googleTokenExpiresAt = 0;

const els = {
  activeTitle: document.querySelector("#activeTitle"),
  endBlockButton: document.querySelector("#endBlockButton"),
  quickGrid: document.querySelector("#quickGrid"),
  manualForm: document.querySelector("#fixLastForm"),
  manualCategory: document.querySelector("#manualCategory"),
  manualStart: document.querySelector("#manualStart"),
  manualEnd: document.querySelector("#manualEnd"),
  manualNote: document.querySelector("#manualNote"),
  fixLastForm: document.querySelector("#fixLastForm"),
  fixLastButton: document.querySelector("#fixLastButton"),
  syncLastButton: document.querySelector("#syncLastButton"),
  lastBlockTitle: document.querySelector("#lastBlockTitle"),
  lastSyncStatus: document.querySelector("#lastSyncStatus"),
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
  connectGoogleButton: document.querySelector("#connectGoogleButton"),
  syncPlanButton: document.querySelector("#syncPlanButton"),
  googleStatus: document.querySelector("#googleStatus"),
  planCalendarStatus: document.querySelector("#planCalendarStatus"),
  actualCalendarStatus: document.querySelector("#actualCalendarStatus"),
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
  initGoogleClient();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => activateTab(tab.dataset.tab));
  });

  els.endBlockButton.addEventListener("click", () => endActiveBlock());
  els.manualForm.addEventListener("submit", fixLastBlock);
  els.fixLastButton.addEventListener("click", toggleFixLastForm);
  els.syncLastButton.addEventListener("click", retrySyncLastBlock);
  els.planForm.addEventListener("submit", addPlanBlock);
  els.addPlanButton.addEventListener("click", () => {
    els.planForm.hidden = !els.planForm.hidden;
  });
  els.exportButton.addEventListener("click", exportMarkdown);
  els.resetButton.addEventListener("click", resetLocalData);
  els.connectGoogleButton.addEventListener("click", connectGoogle);
  els.syncPlanButton.addEventListener("click", syncPlanFromGoogle);
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
    button.textContent = category.code;
    button.title = category.name;
    button.addEventListener("click", () => startQuickBlock(category.id));
    els.quickGrid.append(button);
  });
}

function fillSelect(select) {
  select.innerHTML = "";
  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.code;
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

async function startQuickBlock(categoryId) {
  if (state.active) await endActiveBlock(false);
  state.active = {
    id: crypto.randomUUID(),
    categoryId,
    start: new Date().toISOString(),
  };
  saveState();
  render();
}

async function endActiveBlock(shouldRender = true) {
  if (!state.active) return;
  const end = new Date();
  const start = new Date(state.active.start);
  if (end.getTime() - start.getTime() < 60 * 1000) {
    end.setMinutes(end.getMinutes() + 5);
  }
  const block = {
    id: state.active.id,
    categoryId: state.active.categoryId,
    note: "",
    start: state.active.start,
    end: end.toISOString(),
  };
  state.actual.push(block);
  state.active = null;
  saveState();
  await syncActualBlock(block);
  if (shouldRender) render();
}

async function addManualActual(event) {
  event.preventDefault();
  const block = buildBlockFromForm("actual", els.manualCategory.value, els.manualStart.value, els.manualEnd.value, els.manualNote.value);
  state.actual.push(block);
  els.manualNote.value = "";
  saveState();
  await syncActualBlock(block);
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
  renderLastBlock();
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

function renderLastBlock() {
  const block = getLastActualBlock();
  if (!block) {
    els.lastBlockTitle.textContent = "No actual yet";
    els.lastSyncStatus.textContent = "Not synced";
    els.fixLastButton.disabled = true;
    els.syncLastButton.disabled = true;
    els.fixLastForm.hidden = true;
    return;
  }

  els.lastBlockTitle.textContent = `${categoryShortLabel(block.categoryId)} ${formatTime(block.start)}-${formatTime(block.end)}`;
  els.lastSyncStatus.textContent = block.googleEventId ? "Saved to GCal" : syncHint();
  els.fixLastButton.disabled = false;
  els.syncLastButton.disabled = Boolean(block.googleEventId);
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
    calendarLink.href = block.htmlLink || googleCalendarUrl(block, type);
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
  const adherence = planMinutes ? Math.round((Math.min(planMinutes, actualMinutes) / planMinutes) * 100) : 0;
  const topActual = topCategoryMinutes(state.actual, start, end);
  const largestDrift = largestCategoryDrift(start, end);

  els.metricsGrid.innerHTML = "";
  [
    ["Plan", formatHours(planMinutes)],
    ["Actual", formatHours(actualMinutes)],
    ["Adherence", `${adherence}%`],
    ["Top Actual", topActual ? `${categoryShortLabel(topActual.categoryId)} ${formatHours(topActual.minutes)}` : "0h"],
    ["Largest Drift", largestDrift ? `${categoryShortLabel(largestDrift.categoryId)} ${formatSignedHours(largestDrift.delta)}` : "0h"],
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
      <td>${categoryLabel(category.id)}</td>
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

function toggleFixLastForm() {
  const block = getLastActualBlock();
  if (!block) return;
  els.fixLastForm.hidden = !els.fixLastForm.hidden;
  if (!els.fixLastForm.hidden) {
    populateFixLastForm(block);
  }
}

function populateFixLastForm(block) {
  els.manualCategory.value = block.categoryId;
  els.manualStart.value = toTimeInput(new Date(block.start));
  els.manualEnd.value = toTimeInput(new Date(block.end));
  els.manualNote.value = block.note || "";
}

async function fixLastBlock(event) {
  event.preventDefault();
  const block = getLastActualBlock();
  if (!block) return;
  const fixed = buildBlockFromForm("actual", els.manualCategory.value, els.manualStart.value, els.manualEnd.value, els.manualNote.value);
  block.categoryId = fixed.categoryId;
  block.note = fixed.note;
  block.start = fixed.start;
  block.end = fixed.end;
  saveState();
  await updateActualBlock(block);
  els.fixLastForm.hidden = true;
  render();
}

async function retrySyncLastBlock() {
  const block = getLastActualBlock();
  if (!block) return;
  await syncActualBlock(block, { forceStatus: true });
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
    "",
    "## Category Delta",
    "| Category | Plan | Actual | Delta |",
    "|---|---:|---:|---:|",
  ];

  categories.forEach((category) => {
    const planned = totalMinutes(state.plan.filter((block) => block.categoryId === category.id), start, end);
    const actual = totalMinutes(state.actual.filter((block) => block.categoryId === category.id), start, end);
    if (planned || actual) {
      lines.push(`| ${categoryLabel(category.id)} | ${formatHours(planned)} | ${formatHours(actual)} | ${formatSignedHours(actual - planned)} |`);
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
  state.google = defaultGoogleState();
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

function initGoogleClient() {
  renderGoogleStatus("Loading Google...");
  waitForGoogleIdentity()
    .then(() => {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: googleClientId,
        scope: googleScopes,
        callback: handleGoogleToken,
        error_callback: () => renderGoogleStatus("GCal error"),
      });
      renderGoogleState();
    })
    .catch(() => renderGoogleStatus("GCal unavailable"));
}

function waitForGoogleIdentity() {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (window.google?.accounts?.oauth2) {
        clearInterval(timer);
        resolve();
      } else if (attempts > 80) {
        clearInterval(timer);
        reject(new Error("Google Identity Services did not load"));
      }
    }, 100);
  });
}

function connectGoogle() {
  if (!tokenClient) {
    renderGoogleStatus("GCal unavailable");
    return;
  }
  tokenClient.requestAccessToken({ prompt: googleAccessToken ? "" : "consent" });
}

async function handleGoogleToken(response) {
  if (response.error) {
    renderGoogleStatus("GCal denied");
    return;
  }
  googleAccessToken = response.access_token;
  googleTokenExpiresAt = Date.now() + Number(response.expires_in || 3600) * 1000;
  renderGoogleStatus("Connected");
  await refreshGoogleCalendars();
}

async function refreshGoogleCalendars() {
  try {
    const data = await gcalFetch("/users/me/calendarList");
    const calendars = data.items || [];
    const byName = new Map(calendars.map((calendar) => [calendar.summary, calendar]));
    state.google.planCalendarIds = Object.fromEntries(
      categories.map((category) => [category.id, byName.get(category.code)?.id || ""]),
    );
    const markerPlan = calendars.find((calendar) => planMarkerCalendarNames.includes(calendar.summary));
    const actual = calendars.find((calendar) => actualCalendarNames.includes(calendar.summary));
    state.google.planCalendarId = markerPlan?.id || "";
    state.google.actualCalendarId = actual?.id || "";
    state.google.actualCalendarName = actual?.summary || "";
    saveState();
    renderGoogleState();
  } catch {
    renderGoogleStatus("GCal lookup failed");
  }
}

async function syncPlanFromGoogle() {
  if (!(await ensureGoogleReady())) return;
  const planSources = categories
    .map((category) => ({ ...category, calendarId: state.google.planCalendarIds?.[category.id] || "" }))
    .filter((category) => category.calendarId);

  if (planSources.length === 0) {
    renderGoogleStatus("Missing LD8 calendars");
    return;
  }

  const start = startOfWeek(new Date());
  const end = addDays(start, 7);
  const params = new URLSearchParams({
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
  });

  try {
    renderGoogleStatus("Syncing plan...");
    const results = await Promise.all(
      planSources.map(async (category) => {
        const data = await gcalFetch(`/calendars/${encodeURIComponent(category.calendarId)}/events?${params.toString()}`);
        return { category, items: data.items || [] };
      }),
    );
    state.plan = state.plan.filter((block) => block.source !== "gcal-plan" || new Date(block.start) < start || new Date(block.start) >= end);
    let importedCount = 0;
    results.forEach(({ category, items }) => {
      items
        .filter((event) => event.start?.dateTime && event.end?.dateTime)
        .forEach((event) => {
          importedCount += 1;
          state.plan.push({
            id: `gcal-plan-${category.id}-${event.id}`,
            categoryId: category.id,
            note: event.summary || "",
            start: event.start.dateTime,
            end: event.end.dateTime,
            source: "gcal-plan",
            googleEventId: event.id,
            htmlLink: event.htmlLink || "",
          });
        });
    });
    saveState();
    render();
    renderGoogleStatus(`Synced ${importedCount} plan`);
  } catch {
    renderGoogleStatus("Plan sync failed");
  }
}

async function syncActualBlock(block, options = {}) {
  if (block.googleEventId) {
    if (options.forceStatus) renderGoogleStatus("Already saved");
    return;
  }
  if (!googleAccessToken) {
    renderGoogleStatus("Connect GCal first");
    return;
  }
  if (!state.google.actualCalendarId) {
    await refreshGoogleCalendars();
  }
  if (!state.google.actualCalendarId) {
    renderGoogleStatus("Missing Actual-Time Log");
    return;
  }

  try {
    const event = await gcalFetch(`/calendars/${encodeURIComponent(state.google.actualCalendarId)}/events`, {
      method: "POST",
      body: JSON.stringify(actualEventPayload(block)),
    });
    block.googleEventId = event.id;
    block.htmlLink = event.htmlLink || "";
    saveState();
    renderGoogleStatus("Actual saved to GCal");
    render();
  } catch {
    renderGoogleStatus("Actual local only");
  }
}

async function updateActualBlock(block) {
  if (!block.googleEventId) {
    await syncActualBlock(block, { forceStatus: true });
    return;
  }
  if (!googleAccessToken) {
    renderGoogleStatus("Connect GCal first");
    return;
  }
  if (!state.google.actualCalendarId) {
    await refreshGoogleCalendars();
  }
  if (!state.google.actualCalendarId) {
    renderGoogleStatus("Missing Actual-Time Log");
    return;
  }

  try {
    const event = await gcalFetch(`/calendars/${encodeURIComponent(state.google.actualCalendarId)}/events/${encodeURIComponent(block.googleEventId)}`, {
      method: "PATCH",
      body: JSON.stringify(actualEventPayload(block)),
    });
    block.htmlLink = event.htmlLink || block.htmlLink || "";
    saveState();
    renderGoogleStatus("Actual fixed in GCal");
  } catch {
    renderGoogleStatus("Fix local only");
  }
}

function actualEventPayload(block) {
  return {
    summary: `Actual: ${categoryLabel(block.categoryId)}`,
    description: block.note || "Logged from TimeBlock Reality",
    start: { dateTime: block.start, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    end: { dateTime: block.end, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    extendedProperties: {
      private: {
        ld8: block.categoryId,
        source: "timeblock-reality",
      },
    },
  };
}

async function ensureGoogleReady() {
  if (!googleAccessToken || Date.now() > googleTokenExpiresAt - 60000) {
    connectGoogle();
    return false;
  }
  if (!hasAnyPlanCalendar() || !state.google.actualCalendarId) {
    await refreshGoogleCalendars();
  }
  return Boolean(hasAnyPlanCalendar() || state.google.actualCalendarId);
}

async function gcalFetch(path, options = {}) {
  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${googleAccessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`Google Calendar API failed: ${response.status}`);
  return response.json();
}

function inferCategoryId(text) {
  const normalized = text.toLowerCase();
  return (
    categories.find((category) => normalized.includes(category.code.toLowerCase()) || normalized.includes(category.name.toLowerCase()))?.id ||
    "mm"
  );
}

function hasAnyPlanCalendar() {
  return Object.values(state.google.planCalendarIds || {}).some(Boolean);
}

function renderGoogleStatus(status) {
  els.googleStatus.textContent = status;
  if (els.lastSyncStatus && getLastActualBlock()) {
    els.lastSyncStatus.textContent = getLastActualBlock().googleEventId ? "Saved to GCal" : status;
  }
}

function renderGoogleState() {
  els.connectGoogleButton.disabled = !tokenClient;
  els.syncPlanButton.disabled = !googleAccessToken;
  els.googleStatus.textContent = googleAccessToken ? "Connected" : "Not connected";
  const foundPlanCount = Object.values(state.google.planCalendarIds || {}).filter(Boolean).length;
  els.planCalendarStatus.textContent = foundPlanCount ? `${foundPlanCount}/8 LD8 found` : "LD8 calendars";
  els.actualCalendarStatus.textContent = state.google.actualCalendarId ? `${state.google.actualCalendarName || actualCalendarNames[0]} found` : actualCalendarNames[0];
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey)) || {};
    return {
      plan: Array.isArray(saved.plan) ? saved.plan : [],
      actual: Array.isArray(saved.actual) ? saved.actual : [],
      active: saved.active || null,
      google: { ...defaultGoogleState(), ...(saved.google || {}) },
    };
  } catch {
    return { plan: [], actual: [], active: null, google: defaultGoogleState() };
  }
}

function defaultGoogleState() {
  return {
    planCalendarId: "",
    planCalendarIds: {},
    actualCalendarId: "",
    actualCalendarName: "",
  };
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function categoryLabel(id) {
  const category = categories.find((item) => item.id === id);
  return category ? `${category.code} - ${category.name}` : id;
}

function categoryShortLabel(id) {
  return categories.find((category) => category.id === id)?.code || id;
}

function getLastActualBlock() {
  return state.actual[state.actual.length - 1];
}

function syncHint() {
  if (!googleAccessToken) return "Connect GCal first";
  if (!state.google.actualCalendarId) return "Missing Actual-Time Log";
  return "Not synced";
}

function topCategoryMinutes(blocks, start, end) {
  const totals = categories.map((category) => ({
    categoryId: category.id,
    minutes: totalMinutes(blocks.filter((block) => block.categoryId === category.id), start, end),
  }));
  return totals.sort((a, b) => b.minutes - a.minutes).find((item) => item.minutes > 0);
}

function largestCategoryDrift(start, end) {
  const deltas = categories.map((category) => {
    const planned = totalMinutes(state.plan.filter((block) => block.categoryId === category.id), start, end);
    const actual = totalMinutes(state.actual.filter((block) => block.categoryId === category.id), start, end);
    return { categoryId: category.id, delta: actual - planned };
  });
  return deltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).find((item) => item.delta !== 0);
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
