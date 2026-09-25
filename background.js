const ALARM_NAME = "rss-check";

// How often to check feeds.
const DEFAULT_CHECK_MINUTES = 5;
const ALLOWED_CHECK_MINUTES = [1, 5, 15, 30, 60];

// How many visible items to keep in popup list.
const MAX_VISIBLE_ITEMS = 200;

// How many entries to inspect from each feed.
const MAX_ITEMS_PER_FETCH = 50;

// How many seen item IDs to remember per feed.
const MAX_SEEN_PER_FEED = 500;

chrome.runtime.onInstalled.addListener(async () => {
  await initializeSeenIfNeeded();

  let state = await getState();

  if (!state.initialized) {
    state.initialized = true;
    await saveState(state);
  }

  await createCheckAlarm();
  await updateBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await createCheckAlarm();
  await checkFeeds(false);
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await checkFeeds(false);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) {
    return;
  }

  if (message.type === "ADD_FEED") {
    addFeed(message.url, message.name).then((result) =>
      sendResponse(result)
    );
    return true;
  }

  if (message.type === "REMOVE_FEED") {
    removeFeed(message.url).then((result) => sendResponse(result));
    return true;
  }

  if (message.type === "RENAME_FEED") {
    renameFeed(message.url, message.name).then((result) =>
      sendResponse(result)
    );
    return true;
  }

  if (message.type === "CLEAR_ITEMS") {
    clearItems().then((result) => sendResponse(result));
    return true;
  }

  if (message.type === "MARK_READ") {
    markRead(message.id).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "MARK_ALL_READ") {
    markAllRead().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "UPDATE_BADGE") {
    updateBadge().then(() => sendResponse({ ok: true }));
    return true;
  }

    if (message.type === "SET_CHECK_INTERVAL") {
    setCheckInterval(message.minutes).then((result) =>
      sendResponse(result)
    );
    return true;
  }
});

async function getState() {
  const { state } = await chrome.storage.local.get("state");

  const safe = state || {};

  const feeds = Array.isArray(safe.feeds)
    ? safe.feeds.map(normalizeFeed).filter(Boolean)
    : [];

  const items = Array.isArray(safe.items)
    ? safe.items.filter((item) => item && item.id)
    : [];

  const seen =
    safe.seen && typeof safe.seen === "object" && !Array.isArray(safe.seen)
      ? safe.seen
      : {};

  const status =
    safe.status &&
    typeof safe.status === "object" &&
    !Array.isArray(safe.status)
      ? safe.status
      : {};

  return {
    initialized: Boolean(safe.initialized),
    feeds,
    items,
    seen,
    status
  };
}

async function saveState(state) {
  await chrome.storage.local.set({ state });
}

// One-time migration:
// If old version did not have a separate "seen" memory,
// mark current feed entries as seen and hide old visible items.
async function initializeSeenIfNeeded() {
  const { state } = await chrome.storage.local.get("state");

  const existing = state || {};

  // Already migrated/new format.
  if (
    existing.seen &&
    typeof existing.seen === "object" &&
    !Array.isArray(existing.seen)
  ) {
    return;
  }

  const newState = await getState();

  newState.seen = {};
  newState.status = newState.status || {};

  for (const feed of newState.feeds) {
    try {
      const response = await fetch(feed.url, {
        cache: "no-store",
        headers: {
          Accept:
            "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"
        }
      });

      if (!response.ok) {
        newState.seen[feed.url] = [];
        setStatus(newState, feed.url, false, `HTTP ${response.status}`);
        continue;
      }

      const xml = await response.text();

      if (looksLikeHtmlPage(xml)) {
        newState.seen[feed.url] = [];
        setStatus(newState, feed.url, false, "Not an RSS/Atom feed");
        continue;
      }

      const feedItems = parseItems(xml).slice(0, MAX_ITEMS_PER_FETCH);

      const rawIds = feedItems
        .map((item) => item.link || item.guid || item.title)
        .filter(Boolean);

      newState.seen[feed.url] = rawIds.slice(0, MAX_SEEN_PER_FEED);
      setStatus(newState, feed.url, true, "Feed OK");
    } catch (error) {
      console.error("initializeSeenIfNeeded feed error:", feed.url, error);
      newState.seen[feed.url] = [];
      setStatus(newState, feed.url, false, "Could not fetch feed");
    }
  }

  // Hide old items from previous version so old posts do not show as new.
  newState.items = [];
  newState.initialized = true;

  await saveState(newState);
}

async function addFeed(inputUrl, inputName) {
  const url = normalizeUrl(inputUrl);
  const requestedName = cleanName(inputName);

  if (!url) {
    return {
      ok: false,
      error: "Enter a valid http or https RSS feed URL."
    };
  }

  const state = await getState();

  const existing = state.feeds.find((feed) => feed.url === url);

  if (existing) {
    // If user adds same URL with a new name, update name.
    if (requestedName && existing.name !== requestedName) {
      existing.name = requestedName;
      await saveState(state);
      return { ok: true, name: existing.name };
    }

    return {
      ok: false,
      error: "Already subscribed to this feed."
    };
  }

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept:
          "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"
      }
    });

    if (!response.ok) {
      return {
        ok: false,
        error: `Feed returned HTTP ${response.status}.`
      };
    }

    const xml = await response.text();

    if (looksLikeHtmlPage(xml)) {
      return {
        ok: false,
        error: "That URL appears to be a normal web page, not RSS/Atom."
      };
    }

    const feedTitle = parseFeedTitle(xml);
    const feedItems = parseItems(xml).slice(0, MAX_ITEMS_PER_FETCH);

    const rawIds = feedItems
      .map((item) => item.link || item.guid || item.title)
      .filter(Boolean);

    const finalName =
      requestedName ||
      feedTitle ||
      hostnameFromUrl(url);

    state.feeds.push({
      url,
      name: finalName
    });

    // Remember current items as already seen.
    // Do NOT show them as new old posts.
    state.seen[url] = rawIds.slice(0, MAX_SEEN_PER_FEED);

    setStatus(state, url, true, "Feed added");

    await saveState(state);
    await updateBadge();

    return {
      ok: true,
      name: finalName
    };
  } catch (error) {
    console.error("Add feed error:", error);

    return {
      ok: false,
      error:
        "Could not load feed. Make sure the URL points directly to RSS/Atom XML."
    };
  }
}

async function removeFeed(inputUrl) {
  const url = normalizeUrl(inputUrl);

  const state = await getState();

  state.feeds = state.feeds.filter(
    (feed) => feed.url !== url && feed.url !== inputUrl
  );

  state.items = state.items.filter(
    (item) => item.feedUrl !== url && item.feedUrl !== inputUrl
  );

  delete state.seen[url];
  delete state.status[url];

  if (inputUrl && inputUrl !== url) {
    delete state.seen[inputUrl];
    delete state.status[inputUrl];
  }

  await saveState(state);
  await updateBadge();

  return { ok: true };
}

async function renameFeed(inputUrl, inputName) {
  const url = normalizeUrl(inputUrl);
  const name = cleanName(inputName);

  if (!url) {
    return {
      ok: false,
      error: "Feed URL is missing."
    };
  }

  const state = await getState();

  const feed = state.feeds.find((x) => x.url === url);

  if (!feed) {
    return {
      ok: false,
      error: "Feed not found."
    };
  }

  feed.name = name;

  await saveState(state);

  return { ok: true };
}

async function clearItems() {
  const state = await getState();

  // Remove visible items only.
  // Keep state.seen so old posts do not return.
  state.items = [];

  await saveState(state);
  await updateBadge();

  return { ok: true };
}

async function checkFeeds(markAsRead, onlyFeedUrl = null) {
  const state = await getState();

  const feedUrls = onlyFeedUrl
    ? [onlyFeedUrl]
    : state.feeds.map((feed) => feed.url);

  let storageChanged = false;

  for (const feedUrl of feedUrls) {
    try {
      const response = await fetch(feedUrl, {
        cache: "no-store",
        headers: {
          Accept:
            "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"
        }
      });

      if (!response.ok) {
        console.warn(`Feed failed: ${feedUrl} ${response.status}`);

        if (
          setStatus(state, feedUrl, false, `HTTP ${response.status}`)
        ) {
          storageChanged = true;
        }

        continue;
      }

      const xml = await response.text();

      if (looksLikeHtmlPage(xml)) {
        if (
          setStatus(state, feedUrl, false, "Not an RSS/Atom feed")
        ) {
          storageChanged = true;
        }

        continue;
      }

      const feedItems = parseItems(xml).slice(0, MAX_ITEMS_PER_FETCH);

      if (!Array.isArray(state.seen[feedUrl])) {
        state.seen[feedUrl] = [];
      }

      const seenSet = new Set(state.seen[feedUrl]);
      let seenChanged = false;

      for (const item of feedItems) {
        const rawId = item.link || item.guid || item.title;

        if (!rawId) {
          continue;
        }

        if (!seenSet.has(rawId)) {
          seenSet.add(rawId);
          seenChanged = true;

          // If markAsRead is true, we only remember it, not show it.
          if (!markAsRead) {
            const id = `${feedUrl}#${rawId}`;

            const alreadyVisible = state.items.some((x) => x.id === id);

            if (!alreadyVisible) {
              state.items.unshift({
                id,
                title: cleanText(item.title) || "New item",
                link: item.link || feedUrl,
                feedUrl,
                addedAt: Date.now(),
                read: false
              });

              storageChanged = true;
            }
          }
        }
      }

      if (seenChanged) {
        state.seen[feedUrl] = Array.from(seenSet).slice(
          -MAX_SEEN_PER_FEED
        );

        storageChanged = true;
      }

      if (setStatus(state, feedUrl, true, "Feed OK")) {
        storageChanged = true;
      }
    } catch (error) {
      console.error(`Feed error: ${feedUrl}`, error);

      if (setStatus(state, feedUrl, false, "Could not fetch feed")) {
        storageChanged = true;
      }
    }
  }

  if (storageChanged) {
    state.items = state.items.slice(0, MAX_VISIBLE_ITEMS);
    await saveState(state);
  }

  await updateBadge();
}

function setStatus(state, feedUrl, ok, message) {
  if (!state.status || typeof state.status !== "object") {
    state.status = {};
  }

  const current = state.status[feedUrl] || {};

  if (current.ok === ok && current.message === message) {
    return false;
  }

  state.status[feedUrl] = {
    ok,
    message,
    lastChecked: Date.now()
  };

  return true;
}

async function updateBadge() {
  const state = await getState();

  const unread = state.items.filter((item) => !item.read).length;

  const text = unread > 0 ? (unread > 99 ? "99+" : String(unread)) : "";

  await chrome.action.setBadgeText({ text });

  if (text) {
    await chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
  }
}

async function markRead(id) {
  const state = await getState();

  const item = state.items.find((x) => x.id === id);

  if (item && !item.read) {
    item.read = true;
    await saveState(state);
  }

  await updateBadge();
}

async function markAllRead() {
  const state = await getState();

  for (const item of state.items) {
    item.read = true;
  }

  await saveState(state);
  await updateBadge();
}

function normalizeFeed(feed) {
  if (typeof feed === "string") {
    return {
      url: feed,
      name: ""
    };
  }

  if (feed && typeof feed.url === "string" && feed.url) {
    return {
      url: feed.url,
      name: typeof feed.name === "string" ? feed.name : ""
    };
  }

  return null;
}

function normalizeUrl(input) {
  let text = String(input || "").trim();

  if (!text) {
    return "";
  }

  if (!/^https?:\/\//i.test(text)) {
    text = "https://" + text;
  }

  try {
    const url = new URL(text);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }

    return url.href;
  } catch {
    return "";
  }
}

function hostnameFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function cleanName(value) {
  return String(value || "")
    .trim()
    .slice(0, 80);
}

function looksLikeHtmlPage(xml) {
  const sample = String(xml || "")
    .slice(0, 1000)
    .toLowerCase();

  const looksHtml =
    sample.includes("<html") ||
    sample.includes("<!doctype html");

  const looksFeed =
    sample.includes("<rss") ||
    sample.includes("<feed") ||
    sample.includes("<item") ||
    sample.includes("<entry");

  return looksHtml && !looksFeed;
}

function parseFeedTitle(xml) {
  let match = xml.match(
    /<channel[^>]*>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i
  );

  if (!match) {
    match = xml.match(
      /<feed[^>]*>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i
    );
  }

  if (!match) {
    match = xml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  }

  if (!match) {
    return "";
  }

  let title = match[1].trim();

  title = title.replace(/^<!\[CDATA\[|\]\]>$/g, "");

  return cleanText(title).slice(0, 80);
}

async function getCheckIntervalMinutes() {
  try {
    const { settings } = await chrome.storage.local.get("settings");

    const safe = settings || {};

    const minutes = Number(safe.checkIntervalMinutes);

    if (ALLOWED_CHECK_MINUTES.includes(minutes)) {
      return minutes;
    }
  } catch (error) {
    console.error("getCheckIntervalMinutes error:", error);
  }

  return DEFAULT_CHECK_MINUTES;
}

async function createCheckAlarm() {
  const minutes = await getCheckIntervalMinutes();

  chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: minutes
  });
}

async function setCheckInterval(minutes) {
  const value = Number(minutes);

  if (!ALLOWED_CHECK_MINUTES.includes(value)) {
    return {
      ok: false,
      error: "Invalid check interval."
    };
  }

  try {
    const { settings } = await chrome.storage.local.get("settings");

    const newSettings = Object.assign(
      {},
      settings || {},
      {
        checkIntervalMinutes: value
      }
    );

    await chrome.storage.local.set({ settings: newSettings });

    await createCheckAlarm();

    return {
      ok: true,
      minutes: value
    };
  } catch (error) {
    console.error("setCheckInterval error:", error);

    return {
      ok: false,
      error: "Could not save check interval."
    };
  }
}

function parseItems(xml) {
  const items = [];

  const blocks =
    xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi) || [];

  for (const block of blocks) {
    const title = getTagValue(block, "title");

    const guid =
      getTagValue(block, "guid") || getTagValue(block, "id");

    let link = "";

    const linkHrefMatch = block.match(/<link[^>]*href=["']([^"']+)["']/i);

    if (linkHrefMatch && linkHrefMatch[1]) {
      link = linkHrefMatch[1].trim();
    } else {
      link = getTagValue(block, "link");
    }

    items.push({
      title,
      link,
      guid
    });
  }

  return items;
}

function getTagValue(block, tag) {
  const escapedTag = tag.replace(/[:/]/g, "\\$&");

  const regex = new RegExp(
    `<${escapedTag}[^>]*>([\\s\\S]*?)<\\/${escapedTag}>`,
    "i"
  );

  const match = block.match(regex);

  if (!match) {
    return "";
  }

  let value = match[1].trim();

  value = value.replace(/^<!\[CDATA\[|\]\]>$/g, "");
  value = value.replace(/<[^>]*>/g, " ");

  return decodeEntities(value.trim());
}

function cleanText(value) {
  let text = String(value || "");

  text = text.replace(/<[^>]*>/g, " ");
  text = decodeEntities(text);
  text = text.replace(/\s+/g, " ").trim();

  return text.slice(0, 200);
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (match, num) => {
      try {
        return String.fromCharCode(Number(num));
      } catch {
        return match;
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
      try {
        return String.fromCharCode(parseInt(hex, 16));
      } catch {
        return match;
      }
    });
}
