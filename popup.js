const MAX_SEEN_PER_FEED = 500;
const ALLOWED_THEMES = ["black", "dim", "light"];

function showFatalError(message) {
  const el = document.getElementById("fatalError");

  if (el) {
    el.textContent += message + "\n";
  }

  console.error(message);
}

window.addEventListener("error", (event) => {
  showFatalError(
    "Popup script error: " + (event.message || String(event))
  );
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;

  const text =
    (reason && reason.message) ||
    String(reason);

  showFatalError("Unhandled promise error: " + text);
});

async function sendMessageSafe(message) {
  try {
    if (
      !chrome ||
      !chrome.runtime ||
      typeof chrome.runtime.sendMessage !== "function"
    ) {
      return {
        ok: false,
        error: "chrome.runtime.sendMessage is unavailable."
      };
    }

    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    const text = (error && error.message) || String(error);

    console.error("sendMessage failed", message, error);

    return {
      ok: false,
      error: text
    };
  }
}

function normalizeFeed(feed) {
  if (typeof feed === "string") {
    return {
      url: feed,
      name: ""
    };
  }

  if (feed && feed.url) {
    return {
      url: String(feed.url),
      name: typeof feed.name === "string" ? feed.name : ""
    };
  }

  return null;
}

function hostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function applyTheme(theme) {
  if (!ALLOWED_THEMES.includes(theme)) {
    theme = "black";
  }

  document.body.dataset.theme = theme;
}

async function loadTheme() {
  try {
    const { settings } = await chrome.storage.local.get("settings");

    const safe = settings || {};

    const theme = ALLOWED_THEMES.includes(safe.theme)
      ? safe.theme
      : "black";

    applyTheme(theme);

    const themeSelect = document.getElementById("themeSelect");

    if (themeSelect) {
      themeSelect.value = theme;
    }
  } catch (error) {
    showFatalError(
      "Theme load error: " +
        ((error && error.message) || String(error))
    );
  }
}

async function saveTheme(theme) {
  try {
    if (!ALLOWED_THEMES.includes(theme)) {
      theme = "black";
    }

    const { settings } = await chrome.storage.local.get("settings");

    const newSettings = Object.assign(
      {},
      settings || {},
      {
        theme
      }
    );

    await chrome.storage.local.set({ settings: newSettings });
  } catch (error) {
    showFatalError(
      "Theme save error: " +
        ((error && error.message) || String(error))
    );
  }
}

async function getState() {
  try {
    if (!chrome || !chrome.storage || !chrome.storage.local) {
      throw new Error("chrome.storage.local is unavailable.");
    }

    const { state } = await chrome.storage.local.get("state");

    const safe = state || {};

    const feeds = Array.isArray(safe.feeds)
      ? safe.feeds.map(normalizeFeed).filter(Boolean)
      : [];

    const items = Array.isArray(safe.items)
      ? safe.items.filter((item) => item && item.id)
      : [];

    const status =
      safe.status &&
      typeof safe.status === "object" &&
      !Array.isArray(safe.status)
        ? safe.status
        : {};

    return {
      feeds,
      items,
      status
    };
  } catch (error) {
    showFatalError(
      "Storage error: " + ((error && error.message) || String(error))
    );

    return {
      feeds: [],
      items: [],
      status: {}
    };
  }
}

async function render() {
  try {
    const state = await getState();

    renderFeeds(state.feeds, state.items, state.status);
    renderItems(state.items, state.feeds);
  } catch (error) {
    showFatalError(
      "Render error: " + ((error && error.message) || String(error))
    );
  }
}

function renderFeeds(feeds, items, status) {
  const feedList = document.getElementById("feedList");

  if (!feedList) {
    showFatalError("Missing HTML element: #feedList");
    return;
  }

  feedList.innerHTML = "";

  if (feeds.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No feeds yet. Add one above.";
    feedList.appendChild(li);
    return;
  }

  const unreadCounts = {};

  for (const item of items) {
    if (!item.read) {
      unreadCounts[item.feedUrl] =
        (unreadCounts[item.feedUrl] || 0) + 1;
    }
  }

  for (const feed of feeds) {
    const li = document.createElement("li");
    li.className = "feed-item";

    const feedStatus = status[feed.url] || {};

    const statusDot = document.createElement("span");

    let statusClass = "unknown";

    if (feedStatus.ok === true) {
      statusClass = "ok";
    } else if (feedStatus.ok === false) {
      statusClass = "error";
    }

    statusDot.className = "status-dot " + statusClass;

    const lastCheckedText = feedStatus.lastChecked
      ? "\nLast checked: " +
        new Date(feedStatus.lastChecked).toLocaleString()
      : "";

    statusDot.title =
      (feedStatus.message || "Not checked yet") + lastCheckedText;

    const nameInput = document.createElement("input");
    nameInput.className = "feed-name-input";
    nameInput.type = "text";
    nameInput.placeholder = hostname(feed.url);
    nameInput.value = feed.name || "";

    nameInput.addEventListener("change", async () => {
      await sendMessageSafe({
        type: "RENAME_FEED",
        url: feed.url,
        name: nameInput.value
      });

      render();
    });

    const count = unreadCounts[feed.url] || 0;

    const countSpan = document.createElement("span");
    countSpan.className =
      "feed-count" + (count === 0 ? " zero" : "");
    countSpan.textContent = String(count);
    countSpan.title =
      count === 0
        ? "No new items"
        : `${count} new item${count === 1 ? "" : "s"}`;

    const urlSpan = document.createElement("span");
    urlSpan.className = "feed-url";
    urlSpan.textContent = feed.url;
    urlSpan.title = feed.url;

    const removeButton = document.createElement("button");
    removeButton.className = "small";
    removeButton.textContent = "Remove";

    removeButton.addEventListener("click", async () => {
      const label = feed.name || hostname(feed.url);

      const ok = window.confirm(
        "Remove this feed?\n\n" +
          label +
          "\n" +
          feed.url +
          "\n\nYou will stop receiving updates from it."
      );

      if (!ok) {
        return;
      }

      await sendMessageSafe({
        type: "REMOVE_FEED",
        url: feed.url
      });

      render();
    });

    li.appendChild(statusDot);
    li.appendChild(nameInput);
    li.appendChild(countSpan);
    li.appendChild(urlSpan);
    li.appendChild(removeButton);

    feedList.appendChild(li);
  }
}

function renderItems(items, feeds) {
  const list = document.getElementById("list");

  if (!list) {
    showFatalError("Missing HTML element: #list");
    return;
  }

  list.innerHTML = "";

  const feedNames = new Map(
    feeds.map((feed) => [feed.url, feed.name || hostname(feed.url)])
  );

  const visibleItems = items
    .filter((item) => !item.read)
    .slice(0, 100);

  if (visibleItems.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No new items.";
    list.appendChild(li);
    return;
  }

  for (const item of visibleItems) {
    const li = document.createElement("li");
    li.className = "unread";

    const a = document.createElement("a");
    a.href = "#";
    a.textContent = item.title;

    a.addEventListener("click", async (event) => {
      event.preventDefault();

      // Mark as read first so it is cleared even if popup closes.
      await sendMessageSafe({
        type: "MARK_READ",
        id: item.id
      });

      if (item.link) {
        try {
          await chrome.tabs.create({ url: item.link });
        } catch (error) {
          showFatalError(
            "Could not open link: " +
              ((error && error.message) || String(error))
          );
        }
      }

      render();
    });

    const meta = document.createElement("div");
    meta.className = "meta";

    const feedName =
      feedNames.get(item.feedUrl) || hostname(item.feedUrl);

    meta.textContent = `${feedName} • New • ${new Date(
      item.addedAt
    ).toLocaleString()}`;

    li.appendChild(a);
    li.appendChild(meta);
    list.appendChild(li);
  }
}

async function addFeedFromInput() {
  const nameInput = document.getElementById("feedName");
  const urlInput = document.getElementById("feedUrl");
  const error = document.getElementById("feedError");

  if (!urlInput || !error) {
    showFatalError("Missing HTML element: #feedUrl or #feedError");
    return;
  }

  const url = urlInput.value.trim();
  const name = nameInput ? nameInput.value.trim() : "";

  error.textContent = "";

  if (!url) {
    error.textContent = "Paste an RSS feed URL first.";
    return;
  }

  const response = await sendMessageSafe({
    type: "ADD_FEED",
    url,
    name
  });

  if (!response || !response.ok) {
    error.textContent =
      (response && response.error) || "Could not add feed.";
    return;
  }

  urlInput.value = "";

  if (nameInput) {
    nameInput.value = "";
  }

  render();
}

async function exportData() {
  try {
    if (!chrome || !chrome.storage || !chrome.storage.local) {
      throw new Error("chrome.storage.local is unavailable.");
    }

    const { state } = await chrome.storage.local.get("state");

    const safeState = state || {};

    const feeds = Array.isArray(safeState.feeds)
      ? safeState.feeds.map(normalizeFeed).filter(Boolean)
      : [];

    const seen = {};

    for (const feed of feeds) {
      const seenArray = safeState.seen
        ? safeState.seen[feed.url]
        : [];

      seen[feed.url] = Array.isArray(seenArray)
        ? seenArray.slice(-MAX_SEEN_PER_FEED)
        : [];
    }

    const backup = {
      app: "RSSuperx",
      version: 3,
      exportedAt: new Date().toISOString(),
      state: {
        feeds,
        seen
      }
    };

    const json = JSON.stringify(backup, null, 2);

    const blob = new Blob([json], {
      type: "application/json"
    });

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download =
      "rssuperx-feeds-" +
      new Date().toISOString().slice(0, 10) +
      ".json";

    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  } catch (error) {
    showFatalError(
      "Export error: " + ((error && error.message) || String(error))
    );
  }
}

async function importData(file) {
  try {
    if (!file) {
      return;
    }

    const text = await file.text();
    const parsed = JSON.parse(text);

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid backup file.");
    }

    const importedState =
      parsed.state && typeof parsed.state === "object"
        ? parsed.state
        : parsed;

    const importedFeeds = Array.isArray(importedState.feeds)
      ? importedState.feeds.map(normalizeFeed).filter(Boolean)
      : [];

    const importedSeenRaw =
      importedState.seen &&
      typeof importedState.seen === "object" &&
      !Array.isArray(importedState.seen)
        ? importedState.seen
        : {};

    const ok = window.confirm(
      `Import ${importedFeeds.length} feeds?\n\nThis will replace your current feed list and seen memory.`
    );

    if (!ok) {
      return;
    }

    const replaceSeen = {};

    for (const feed of importedFeeds) {
      replaceSeen[feed.url] = Array.isArray(
        importedSeenRaw[feed.url]
      )
        ? importedSeenRaw[feed.url].slice(-MAX_SEEN_PER_FEED)
        : [];
    }

    const newState = {
      initialized: true,
      feeds: importedFeeds,
      items: [],
      seen: replaceSeen,
      status: {}
    };

    await chrome.storage.local.set({ state: newState });

    // Updates badge after import.
    await sendMessageSafe({ type: "UPDATE_BADGE" });

    render();
  } catch (error) {
    showFatalError(
      "Import error: " + ((error && error.message) || String(error))
    );
  }
}

function bindEvents() {
  const addButton = document.getElementById("addFeed");

  if (addButton) {
    addButton.addEventListener("click", async () => {
      await addFeedFromInput();
    });
  } else {
    showFatalError("Missing HTML element: #addFeed");
  }

  const urlInput = document.getElementById("feedUrl");

  if (urlInput) {
    urlInput.addEventListener("keydown", async (event) => {
      if (event.key === "Enter") {
        await addFeedFromInput();
      }
    });
  }

  const dismissAllButton = document.getElementById("dismissAll");

  if (dismissAllButton) {
    dismissAllButton.addEventListener("click", async () => {
      await sendMessageSafe({ type: "MARK_ALL_READ" });
      render();
    });
  } else {
    showFatalError("Missing HTML element: #dismissAll");
  }

  const exportButton = document.getElementById("exportData");

  if (exportButton) {
    exportButton.addEventListener("click", async () => {
      await exportData();
    });
  } else {
    showFatalError("Missing HTML element: #exportData");
  }

  const importButton = document.getElementById("importButton");
  const importFile = document.getElementById("importFile");

  if (importButton && importFile) {
    importButton.addEventListener("click", () => {
      importFile.click();
    });

    importFile.addEventListener("change", async () => {
      if (importFile.files && importFile.files[0]) {
        await importData(importFile.files[0]);
      }

      importFile.value = "";
    });
  } else {
    showFatalError("Missing HTML element: #importButton or #importFile");
  }

  const themeSelect = document.getElementById("themeSelect");

  if (themeSelect) {
    themeSelect.addEventListener("change", async () => {
      const theme = themeSelect.value;

      applyTheme(theme);
      await saveTheme(theme);
    });
  } else {
    showFatalError("Missing HTML element: #themeSelect");
  }
}

(async function init() {
  try {
    bindEvents();
    await loadTheme();
    await render();
  } catch (error) {
    showFatalError(
      "Init error: " + ((error && error.message) || String(error))
    );
  }
})();
