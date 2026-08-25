const ALARM_NAME = "rss-check";

// How often to check feeds.
// 1 minute is fast. Use 5 if you want less battery/network use.
const CHECK_EVERY_MINUTES = 1;

const MAX_STORED_ITEMS = 200;
const MAX_ITEMS_PER_FEED = 20;

chrome.runtime.onInstalled.addListener(async () => {
  let state = await getState();

  if (!state.initialized) {
    state.initialized = true;
    await saveState(state);
  }

  await updateBadge();

  chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: CHECK_EVERY_MINUTES
  });
});

chrome.runtime.onStartup.addListener(async () => {
  chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: CHECK_EVERY_MINUTES
  });

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
    addFeed(message.url).then((result) => sendResponse(result));
    return true;
  }

  if (message.type === "REMOVE_FEED") {
    removeFeed(message.url).then((result) => sendResponse(result));
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
});

async function getState() {
  const { state } = await chrome.storage.local.get("state");

  const safe = state || {};

  return {
    initialized: Boolean(safe.initialized),
    feeds: Array.isArray(safe.feeds) ? safe.feeds : [],
    items: Array.isArray(safe.items) ? safe.items : []
  };
}

async function saveState(state) {
  await chrome.storage.local.set({ state });
}

async function addFeed(inputUrl) {
  const url = normalizeUrl(inputUrl);

  if (!url) {
    return {
      ok: false,
      error: "Enter a valid http or https RSS feed URL."
    };
  }

  const state = await getState();

  if (state.feeds.includes(url)) {
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
    const feedItems = parseItems(xml).slice(0, MAX_ITEMS_PER_FEED);

    state.feeds.push(url);

    // Mark existing feed items as read so old posts do not flood the badge.
    addItemsToState(state, url, feedItems, true);

    state.items = state.items.slice(0, MAX_STORED_ITEMS);

    await saveState(state);
    await updateBadge();

    return { ok: true };
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
    (feed) => feed !== url && feed !== inputUrl
  );

  state.items = state.items.filter(
    (item) => item.feedUrl !== url && item.feedUrl !== inputUrl
  );

  await saveState(state);
  await updateBadge();

  return { ok: true };
}

async function clearItems() {
  const state = await getState();

  state.items = [];

  await saveState(state);
  await updateBadge();

  return { ok: true };
}

async function checkFeeds(markAsRead, onlyFeedUrl = null) {
  const state = await getState();

  const feeds = onlyFeedUrl ? [onlyFeedUrl] : state.feeds;

  let changed = false;

  for (const feedUrl of feeds) {
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
        continue;
      }

      const xml = await response.text();
      const feedItems = parseItems(xml).slice(0, MAX_ITEMS_PER_FEED);

      if (addItemsToState(state, feedUrl, feedItems, markAsRead)) {
        changed = true;
      }
    } catch (error) {
      console.error(`Feed error: ${feedUrl}`, error);
    }
  }

  if (changed) {
    state.items = state.items.slice(0, MAX_STORED_ITEMS);
    await saveState(state);
  }

  await updateBadge();
}

function addItemsToState(state, feedUrl, feedItems, markAsRead) {
  const knownIds = new Set(state.items.map((item) => item.id));
  let changed = false;

  for (const item of feedItems) {
    const rawId = item.link || item.guid || item.title;

    if (!rawId) {
      continue;
    }

    const id = `${feedUrl}#${rawId}`;

    if (!knownIds.has(id)) {
      knownIds.add(id);

      state.items.unshift({
        id,
        title: cleanText(item.title) || "New item",
        link: item.link || feedUrl,
        feedUrl,
        addedAt: Date.now(),
        read: Boolean(markAsRead)
      });

      changed = true;
    }
  }

  return changed;
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

function parseItems(xml) {
  const items = [];

  const blocks =
    xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi) || [];

  for (const block of blocks) {
    const title = getTagValue(block, "title");

    const guid =
      getTagValue(block, "guid") ||
      getTagValue(block, "id");

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
