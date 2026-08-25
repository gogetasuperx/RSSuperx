// Put your RSS/Atom feed URLs here.
const FEEDS = [
  "https://hnrss.org/frontpage",
  "https://feeds.bbci.co.uk/news/rss.xml"
];

const ALARM_NAME = "rss-check";

// Chrome may limit this to about 1 minute.
// Use 5 if you want to be gentler to websites.
const CHECK_EVERY_MINUTES = 1;

const MAX_STORED_ITEMS = 200;
const MAX_ITEMS_PER_FEED = 20;

chrome.runtime.onInstalled.addListener(async () => {
  let state = await getState();

  // First run: mark current feed items as read so you do not get flooded.
  if (!state.initialized) {
    await checkFeeds(true);

    state = await getState();
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
  if (message && message.type === "MARK_READ") {
    markRead(message.id).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message && message.type === "MARK_ALL_READ") {
    markAllRead().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message && message.type === "GET_STATE") {
    getState().then((state) => sendResponse({ state }));
    return true;
  }
});

async function getState() {
  const { state } = await chrome.storage.local.get("state");

  return (
    state || {
      initialized: false,
      items: []
    }
  );
}

async function saveState(state) {
  await chrome.storage.local.set({ state });
}

async function checkFeeds(markAsRead) {
  const state = await getState();
  const knownIds = new Set(state.items.map((item) => item.id));
  let changed = false;

  for (const feedUrl of FEEDS) {
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

    // Atom feeds often use:
    // <link href="https://example.com/article" />
    const linkHrefMatch = block.match(/<link[^>]*href=["']([^"']+)["']/i);

    if (linkHrefMatch && linkHrefMatch[1]) {
      link = linkHrefMatch[1].trim();
    } else {
      // RSS feeds often use:
      // <link>https://example.com/article</link>
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
