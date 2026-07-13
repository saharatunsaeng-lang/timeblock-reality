const LD8_CATEGORIES = [
  { id: "bd", code: "1 BD", name: "Body & Diet" },
  { id: "sp", code: "2 SP", name: "Spiritual & Purpose" },
  { id: "mm", code: "3 MM", name: "Mind & Memory" },
  { id: "rs", code: "4 RS", name: "Relationships & Social" },
  { id: "cm", code: "5 CM", name: "Career & Money" },
  { id: "fn", code: "6 FN", name: "Finance & Numbers" },
  { id: "ct", code: "7 CT", name: "Contribute" },
  { id: "ls", code: "8 LS", name: "Lifestyle" },
];

const ACTUAL_CALENDAR_NAMES = ["Actual-Time Log", "Actual - Time Log"];
const SOURCE_TAG = "timeblock-reality";
const STATUS_TAG = "status";
const LD8_TAG = "ld8";
const BLOCK_ID_TAG = "blockId";
const ACTIVE_STATUS = "active";
const ACTUAL_STATUS = "actual";
const ACTIVE_PLACEHOLDER_MINUTES = 360;
const BLOCK_LOOKUP_WINDOW_DAYS = 3;

function doGet(event) {
  if (event?.parameter?.mode === "duplicate-ld8") {
    const source = event.parameter.source || "2026-07-06";
    const target = event.parameter.target || "2026-07-13";
    const execute = event.parameter.execute === "1";
    const payload = duplicateLd8Week_(source, target, execute);
    return HtmlService
      .createHtmlOutput(`<pre>${escapeHtml_(JSON.stringify(payload, null, 2))}</pre>`)
      .setTitle(execute ? "LD8 Duplicate Complete" : "LD8 Duplicate Preview");
  }

  if (event?.parameter?.mode === "audit") {
    const payload = JSON.stringify(inspectActualRange_(event.parameter), null, 2);
    return HtmlService
      .createHtmlOutput(`<pre>${escapeHtml_(payload)}</pre>`)
      .setTitle("TimeBlock Audit");
  }

  return HtmlService.createHtmlOutputFromFile("Index")
    .setTitle("TimeBlock Reality")
    .addMetaTag("viewport", "width=device-width, initial-scale=1, viewport-fit=cover");
}

function duplicateLd8Week_(sourceKey, targetKey, execute) {
  const sourceStart = parseDateKey_(sourceKey);
  const targetStart = parseDateKey_(targetKey);
  const sourceEnd = addDays_(sourceStart, 7);
  const targetEnd = addDays_(targetStart, 7);
  const shiftMs = targetStart.getTime() - sourceStart.getTime();
  const calendars = [];
  let totalSource = 0;
  let totalCreated = 0;
  let totalSkipped = 0;

  LD8_CATEGORIES.forEach((category) => {
    const calendar = getFirstCalendarByName_(category.code);
    if (!calendar) {
      calendars.push({ calendar: category.code, found: false, source: 0, created: 0, skipped: 0 });
      return;
    }

    const sourceEvents = calendar.getEvents(sourceStart, sourceEnd);
    const targetKeys = new Set(calendar.getEvents(targetStart, targetEnd).map((event) => calendarEventKey_(event)));
    let created = 0;
    let skipped = 0;

    sourceEvents.forEach((event) => {
      const start = new Date(event.getStartTime().getTime() + shiftMs);
      const end = new Date(event.getEndTime().getTime() + shiftMs);
      const key = calendarEventKey_(event, start, end);
      if (targetKeys.has(key)) {
        skipped += 1;
        return;
      }
      if (execute) {
        const options = {
          description: event.getDescription() || "",
          location: event.getLocation() || "",
        };
        if (event.isAllDayEvent()) {
          calendar.createAllDayEvent(event.getTitle(), start, end, options);
        } else {
          calendar.createEvent(event.getTitle(), start, end, options);
        }
        targetKeys.add(key);
      }
      created += 1;
    });

    totalSource += sourceEvents.length;
    totalCreated += created;
    totalSkipped += skipped;
    calendars.push({ calendar: category.code, found: true, source: sourceEvents.length, created, skipped });
  });

  return {
    mode: execute ? "executed" : "dry-run",
    source: sourceKey,
    target: targetKey,
    sourceEnd: formatDateKey_(sourceEnd),
    targetEnd: formatDateKey_(targetEnd),
    totalSource,
    totalCreated,
    totalSkipped,
    calendars,
  };
}

function calendarEventKey_(event, startOverride, endOverride) {
  const start = startOverride || event.getStartTime();
  const end = endOverride || event.getEndTime();
  return [event.getTitle(), start.getTime(), end.getTime(), event.isAllDayEvent()].join("|");
}

function parseDateKey_(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Invalid date: ${value}`);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatDateKey_(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getBootstrapState(includePlan) {
  const result = {
    calendars: getCalendarStatus(),
    actual: getActualWeekBlocks(),
    active: getActiveBlock(),
    serverTime: new Date().toISOString(),
    timeZone: Session.getScriptTimeZone(),
  };
  if (includePlan) {
    result.plan = syncPlanWeek().blocks;
  }
  return result;
}

function getCalendarStatus() {
  const plan = LD8_CATEGORIES.map((category) => ({
    id: category.id,
    code: category.code,
    found: Boolean(getFirstCalendarByName_(category.code)),
  }));
  const actual = getActualCalendar_();
  return {
    plan,
    planFoundCount: plan.filter((item) => item.found).length,
    actualFound: Boolean(actual),
    actualName: actual ? actual.getName() : ACTUAL_CALENDAR_NAMES[0],
  };
}

function syncPlanWeek() {
  const start = startOfWeek_(new Date());
  const end = addDays_(start, 7);
  const blocks = [];

  LD8_CATEGORIES.forEach((category) => {
    const calendar = getFirstCalendarByName_(category.code);
    if (!calendar) return;

    calendar.getEvents(start, end).forEach((event) => {
      if (event.isAllDayEvent()) return;
      blocks.push(serializePlanEvent_(event, category));
    });
  });

  blocks.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  return {
    blocks,
    calendars: getCalendarStatus(),
  };
}

function createActualBlock(block) {
  const calendar = requireActualCalendar_();
  const normalized = normalizeActualBlock_(block);
  const existing = findEventById_(calendar, normalized.googleEventId) || findEventByBlockId_(calendar, normalized.id, normalized.start);

  if (existing) {
    return finalizeActualEvent_(existing, normalized);
  }

  const event = calendar.createEvent(
    `Actual: ${categoryLabel_(normalized.categoryId)}`,
    new Date(normalized.start),
    new Date(normalized.end),
    { description: normalized.note || "Logged from TimeBlock Reality" },
  );
  tagActualEvent_(event, normalized.categoryId, ACTUAL_STATUS, normalized.id);
  return {
    block: serializeActualEvent_(event, normalized),
    calendars: getCalendarStatus(),
    active: getActiveBlock(),
  };
}

function updateActualBlock(block) {
  const calendar = requireActualCalendar_();
  const normalized = normalizeActualBlock_(block);
  let event = findEventById_(calendar, normalized.googleEventId) || findEventByBlockId_(calendar, normalized.id, normalized.start);

  if (!event) {
    return createActualBlock(normalized);
  }

  return finalizeActualEvent_(event, normalized);
}

function startActiveBlock(block) {
  const calendar = requireActualCalendar_();
  const normalized = normalizeActiveBlock_(block);
  const existing = findEventById_(calendar, normalized.googleEventId) || findEventByBlockId_(calendar, normalized.id, normalized.start);
  const start = new Date(normalized.start);
  const placeholderEnd = addMinutes_(start, ACTIVE_PLACEHOLDER_MINUTES);
  const event = existing || calendar.createEvent(
    `Active: ${categoryLabel_(normalized.categoryId)}`,
    start,
    placeholderEnd,
    { description: "Active block from TimeBlock Reality" },
  );

  event.setTitle(`Active: ${categoryLabel_(normalized.categoryId)}`);
  event.setTime(start, placeholderEnd);
  event.setDescription(normalized.note || "Active block from TimeBlock Reality");
  tagActualEvent_(event, normalized.categoryId, ACTIVE_STATUS, normalized.id);
  return {
    active: serializeActiveEvent_(event, normalized),
    calendars: getCalendarStatus(),
  };
}

function getActiveBlock() {
  const event = findActiveActualEvent_();
  return event ? serializeActiveEvent_(event) : null;
}

function getActualWeekBlocks() {
  const calendar = getActualCalendar_();
  if (!calendar) return [];

  const start = startOfWeek_(new Date());
  const end = addDays_(start, 7);
  const blocks = calendar.getEvents(start, end)
    .filter((event) => !event.isAllDayEvent())
    .filter((event) => event.getTag(STATUS_TAG) !== ACTIVE_STATUS)
    .map((event) => serializeActualCalendarEvent_(event))
    .filter(Boolean);

  blocks.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  return blocks;
}

function inspectActualRange_(params) {
  const calendar = requireActualCalendar_();
  const range = inspectRangeFromParams_(params);
  const start = range.start;
  const end = range.end;
  const categoryId = String(params.categoryId || "");

  const events = calendar.getEvents(start, end)
    .filter((event) => !event.isAllDayEvent())
    .map((event) => serializeActualCalendarEvent_(event))
    .filter(Boolean)
    .filter((block) => !categoryId || block.categoryId === categoryId)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  return {
    calendar: calendar.getName(),
    start: start.toISOString(),
    end: end.toISOString(),
    categoryId,
    count: events.length,
    events,
  };
}

function inspectRangeFromParams_(params) {
  if (params.day) {
    const dayMatch = String(params.day).match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
    if (!dayMatch) throw new Error("Invalid inspect day");
    const startMinutes = Number(params.fromMin || 0);
    const endMinutes = Number(params.toMin || 24 * 60);
    if (Number.isNaN(startMinutes) || Number.isNaN(endMinutes) || endMinutes <= startMinutes) {
      throw new Error("Invalid inspect minutes");
    }

    const start = new Date(Number(dayMatch[1]), Number(dayMatch[2]) - 1, Number(dayMatch[3]), 0, startMinutes, 0, 0);
    const end = new Date(Number(dayMatch[1]), Number(dayMatch[2]) - 1, Number(dayMatch[3]), 0, endMinutes, 0, 0);
    return { start, end };
  }

  const start = new Date(params.start);
  const end = new Date(params.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid inspect range");
  }
  return { start, end };
}

function finalizeActualEvent_(event, normalized) {
  event.setTitle(`Actual: ${categoryLabel_(normalized.categoryId)}`);
  event.setTime(new Date(normalized.start), new Date(normalized.end));
  event.setDescription(normalized.note || "Logged from TimeBlock Reality");
  tagActualEvent_(event, normalized.categoryId, ACTUAL_STATUS, normalized.id);
  return {
    block: serializeActualEvent_(event, normalized),
    calendars: getCalendarStatus(),
    active: getActiveBlock(),
  };
}

function getFirstCalendarByName_(name) {
  const calendars = CalendarApp.getCalendarsByName(name);
  return calendars.length ? calendars[0] : null;
}

function getActualCalendar_() {
  for (const name of ACTUAL_CALENDAR_NAMES) {
    const calendar = getFirstCalendarByName_(name);
    if (calendar) return calendar;
  }
  return null;
}

function requireActualCalendar_() {
  const calendar = getActualCalendar_();
  if (!calendar) {
    throw new Error(`Missing actual calendar: ${ACTUAL_CALENDAR_NAMES.join(" or ")}`);
  }
  return calendar;
}

function normalizeActualBlock_(block) {
  if (!block || typeof block !== "object") throw new Error("Missing block");
  const category = LD8_CATEGORIES.find((item) => item.id === block.categoryId);
  if (!category) throw new Error(`Unknown LD8 category: ${block.categoryId}`);

  const start = new Date(block.start);
  const end = new Date(block.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid block time");
  }
  if (end.getTime() <= start.getTime()) {
    throw new Error("End time must be after start time");
  }

  return {
    id: String(block.id || Utilities.getUuid()),
    categoryId: category.id,
    note: String(block.note || ""),
    start: start.toISOString(),
    end: end.toISOString(),
    googleEventId: block.googleEventId ? String(block.googleEventId) : "",
  };
}

function normalizeActiveBlock_(block) {
  if (!block || typeof block !== "object") throw new Error("Missing block");
  const category = LD8_CATEGORIES.find((item) => item.id === block.categoryId);
  if (!category) throw new Error(`Unknown LD8 category: ${block.categoryId}`);

  const start = new Date(block.start);
  if (Number.isNaN(start.getTime())) {
    throw new Error("Invalid block time");
  }

  return {
    id: String(block.id || Utilities.getUuid()),
    categoryId: category.id,
    note: String(block.note || ""),
    start: start.toISOString(),
    googleEventId: block.googleEventId ? String(block.googleEventId) : "",
  };
}

function serializePlanEvent_(event, category) {
  return {
    id: `gcal-plan-${category.id}-${event.getId()}`,
    categoryId: category.id,
    note: event.getTitle() || "",
    start: event.getStartTime().toISOString(),
    end: event.getEndTime().toISOString(),
    source: "gcal-plan",
    googleEventId: event.getId(),
  };
}

function serializeActualEvent_(event, block) {
  return {
    id: block.id,
    categoryId: block.categoryId,
    note: block.note || "",
    start: block.start,
    end: block.end,
    googleEventId: event.getId(),
    source: SOURCE_TAG,
  };
}

function serializeActiveEvent_(event, fallback) {
  const categoryId = event.getTag(LD8_TAG) || fallback?.categoryId || parseCategoryIdFromTitle_(event.getTitle());
  if (!categoryId) return null;
  return {
    id: event.getTag(BLOCK_ID_TAG) || fallback?.id || `gcal-active-${event.getId()}`,
    categoryId,
    note: fallback?.note || cleanDescription_(event.getDescription()),
    start: event.getStartTime().toISOString(),
    googleEventId: event.getId(),
    source: SOURCE_TAG,
    status: ACTIVE_STATUS,
  };
}

function serializeActualCalendarEvent_(event) {
  const categoryId = event.getTag(LD8_TAG) || parseCategoryIdFromTitle_(event.getTitle());
  if (!categoryId) return null;
  return {
    id: event.getTag(BLOCK_ID_TAG) || `gcal-actual-${event.getId()}`,
    categoryId,
    note: cleanDescription_(event.getDescription()),
    start: event.getStartTime().toISOString(),
    end: event.getEndTime().toISOString(),
    googleEventId: event.getId(),
    source: SOURCE_TAG,
  };
}

function tagActualEvent_(event, categoryId, status, blockId) {
  event.setTag("source", SOURCE_TAG);
  event.setTag(LD8_TAG, categoryId);
  event.setTag(STATUS_TAG, status);
  event.setTag(BLOCK_ID_TAG, blockId);
}

function findEventById_(calendar, eventId) {
  if (!eventId) return null;
  try {
    return calendar.getEventById(eventId);
  } catch (error) {
    return null;
  }
}

function findEventByBlockId_(calendar, blockId, nearTime) {
  if (!blockId) return null;
  const center = nearTime ? new Date(nearTime) : new Date();
  if (Number.isNaN(center.getTime())) return null;
  const start = addDays_(center, -BLOCK_LOOKUP_WINDOW_DAYS);
  const end = addDays_(center, BLOCK_LOOKUP_WINDOW_DAYS);
  const events = calendar.getEvents(start, end)
    .filter((event) => event.getTag(BLOCK_ID_TAG) === blockId)
    .sort((a, b) => b.getStartTime().getTime() - a.getStartTime().getTime());
  return events.length ? events[0] : null;
}

function findActiveActualEvent_() {
  const calendar = getActualCalendar_();
  if (!calendar) return null;

  const start = addDays_(new Date(), -2);
  const end = addDays_(new Date(), 7);
  const activeEvents = calendar.getEvents(start, end)
    .filter((event) => event.getTag(STATUS_TAG) === ACTIVE_STATUS)
    .sort((a, b) => b.getStartTime().getTime() - a.getStartTime().getTime());

  return activeEvents.length ? activeEvents[0] : null;
}

function parseCategoryIdFromTitle_(title) {
  const text = String(title || "");
  const category = LD8_CATEGORIES.find((item) => text.indexOf(item.code) !== -1);
  return category ? category.id : "";
}

function cleanDescription_(description) {
  const text = String(description || "");
  return text === "Logged from TimeBlock Reality" || text === "Active block from TimeBlock Reality" ? "" : text;
}

function escapeHtml_(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function categoryLabel_(id) {
  const category = LD8_CATEGORIES.find((item) => item.id === id);
  return category ? `${category.code} - ${category.name}` : id;
}

function startOfWeek_(date) {
  const current = new Date(date);
  const day = current.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  current.setHours(0, 0, 0, 0);
  current.setDate(current.getDate() + diff);
  return current;
}

function addDays_(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMinutes_(date, minutes) {
  const next = new Date(date);
  next.setMinutes(next.getMinutes() + minutes);
  return next;
}

// Server-side mirror of buildWeeklyMemoryText() in index.html, meant to be invoked
// via `clasp run buildWeeklyMemoryPayload` from a Mac-side script (no browser OAuth
// needed - runs under the Apps Script deployment's own Calendar authorization).
// Returns a payload shaped for ld8-quick-notes' POST /api/notes.
function buildWeeklyMemoryPayload() {
  const start = startOfWeek_(new Date());
  const end = addDays_(start, 7);
  const planBlocks = syncPlanWeek().blocks;
  const actualBlocks = getActualWeekBlocks();

  const planMinutes = sumBlockMinutes_(planBlocks);
  const actualMinutes = sumBlockMinutes_(actualBlocks);
  const matchedMinutes = matchedPlanActualMinutes_(planBlocks, actualBlocks);
  const match = planMinutes ? Math.round((matchedMinutes / planMinutes) * 100) : 0;

  const rows = LD8_CATEGORIES
    .map((category) => {
      const planned = sumBlockMinutes_(planBlocks.filter((block) => block.categoryId === category.id));
      const actual = sumBlockMinutes_(actualBlocks.filter((block) => block.categoryId === category.id));
      return { category, planned, actual, drift: actual - planned };
    })
    .filter((row) => row.planned || row.actual)
    .sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));

  const capturedDays = new Set(actualBlocks.map((block) => dateKey_(block.start))).size;
  const elapsedDays = elapsedWeekDays_(start, end);
  const topActual = rows.filter((row) => row.actual > 0).sort((a, b) => b.actual - a.actual)[0];
  const biggestGap = rows.filter((row) => row.planned > 0 && row.drift < 0).sort((a, b) => a.drift - b.drift)[0];

  const body = [
    "# TimeBlock Reality Weekly Memory",
    "",
    `Week: ${dateKey_(start)} to ${dateKey_(addDays_(end, -1))}`,
    `Plan: ${formatHours_(planMinutes)}`,
    `Actual: ${formatHours_(actualMinutes)}`,
    `Match: ${match}%`,
    `Drift: ${formatSignedHours_(actualMinutes - planMinutes)}`,
    "",
    "## Habit Signals",
    `- Capture habit: ${capturedDays}/${elapsedDays} days`,
    `- Dominant reality: ${topActual ? `${topActual.category.code} ${formatHours_(topActual.actual)}` : "-"}`,
    `- Plan pressure: ${biggestGap ? `${biggestGap.category.code} ${formatSignedHours_(biggestGap.drift)}` : "Stable"}`,
    "",
    "## LD8 Drift",
    ...rows.map((row) => `- ${row.category.code}: plan ${formatHours_(row.planned)}, actual ${formatHours_(row.actual)}, drift ${formatSignedHours_(row.drift)}`),
  ].join("\n");

  return {
    date: dateKey_(new Date()),
    domainId: "3 MM",
    memoryType: "signal",
    title: `Weekly TimeBlock Review - ${dateKey_(start)} to ${dateKey_(addDays_(end, -1))}`,
    body,
  };
}

function sumBlockMinutes_(blocks) {
  return blocks.reduce((sum, block) => sum + minutesBetween_(block.start, block.end), 0);
}

function minutesBetween_(start, end) {
  return Math.max(0, Math.round((new Date(end) - new Date(start)) / 60000));
}

function matchedPlanActualMinutes_(planBlocks, actualBlocks) {
  return actualBlocks.reduce((sum, actual) => {
    const matched = planBlocks
      .filter((plan) => plan.categoryId === actual.categoryId)
      .reduce((innerSum, plan) => innerSum + overlapMinutes_(actual, plan), 0);
    return sum + Math.min(minutesBetween_(actual.start, actual.end), matched);
  }, 0);
}

function overlapMinutes_(first, second) {
  const start = Math.max(new Date(first.start).getTime(), new Date(second.start).getTime());
  const end = Math.min(new Date(first.end).getTime(), new Date(second.end).getTime());
  return Math.max(0, Math.round((end - start) / 60000));
}

function elapsedWeekDays_(start, end) {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const capped = today < end ? today : end;
  return Math.max(1, Math.min(7, Math.ceil((capped - start) / (24 * 60 * 60 * 1000))));
}

function dateKey_(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatHours_(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (!hours) return `${mins}m`;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatSignedHours_(minutes) {
  const sign = minutes > 0 ? "+" : minutes < 0 ? "-" : "";
  return `${sign}${formatHours_(Math.abs(minutes))}`;
}
