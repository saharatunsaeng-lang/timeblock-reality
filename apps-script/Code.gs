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

function doGet() {
  return HtmlService.createHtmlOutputFromFile("Index")
    .setTitle("TimeBlock Reality")
    .addMetaTag("viewport", "width=device-width, initial-scale=1, viewport-fit=cover");
}

function getBootstrapState() {
  return {
    calendars: getCalendarStatus(),
    serverTime: new Date().toISOString(),
    timeZone: Session.getScriptTimeZone(),
  };
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
  const event = calendar.createEvent(
    `Actual: ${categoryLabel_(normalized.categoryId)}`,
    new Date(normalized.start),
    new Date(normalized.end),
    { description: normalized.note || "Logged from TimeBlock Reality" },
  );
  tagActualEvent_(event, normalized.categoryId);
  return {
    block: serializeActualEvent_(event, normalized),
    calendars: getCalendarStatus(),
  };
}

function updateActualBlock(block) {
  const calendar = requireActualCalendar_();
  const normalized = normalizeActualBlock_(block);
  let event = normalized.googleEventId ? calendar.getEventById(normalized.googleEventId) : null;

  if (!event) {
    return createActualBlock(normalized);
  }

  event.setTitle(`Actual: ${categoryLabel_(normalized.categoryId)}`);
  event.setTime(new Date(normalized.start), new Date(normalized.end));
  event.setDescription(normalized.note || "Logged from TimeBlock Reality");
  tagActualEvent_(event, normalized.categoryId);

  return {
    block: serializeActualEvent_(event, normalized),
    calendars: getCalendarStatus(),
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

function tagActualEvent_(event, categoryId) {
  event.setTag("source", SOURCE_TAG);
  event.setTag("ld8", categoryId);
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
