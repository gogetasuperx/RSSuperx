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

async function getSettings() {
  try {
    if (!chrome || !chrome.storage || !chrome.storage.local) {
      throw new Error("chrome.storage.local is unavailable.");
    }

    const { settings } = await chrome.storage.local.get("settings");

    const safe = settings || {};

    // Default is false now.
    // For click-to-clear behavior, opening popup should NOT auto-clear all.
    return {
      autoMarkRead: safe.autoMarkRead === true
    };
  } catch (error) {
    showFatalError(
      "Settings read error: " +
        ((error && error.message) || String(error))
    );

    return {
      autoMarkRead: false
    };
  }
}

async function saveSettings(settings) {
  try {
    if (!chrome || !chrome.storage || !chrome.storage.local) {
      throw new Error("chrome.storage.local is unavailable.");
    }

    await chrome.storage.local.set({ settings });
  } catch (error) {
    showFatalError(
      "Settings save error: " +
        ((error && error.message) || String(error))
    );
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

    return {
      feeds,
      items
    };
  } catch (error) {
    showFatalError(
      "Storage error: " + ((error && error.message) || String(error))
    );

    return {
      feeds: [],
      items: []
    };
  }
}

async function render() {
  try {
    const state = await getState();

    renderFeeds(state.feeds);
    renderItems(state.items, state.feeds);
  } catch (error) {
    showFatalError(
      "Render error: " + ((error && error.message) || String(error))
    );
  }
}

function renderFeeds(feeds) {
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

  for (const feed of feeds) {
    const li = document.createElement("li");
    li.className = "feed-item";

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

    const urlSpan = document.createElement("span");
    urlSpan.className = "feed-url";
    urlSpan.textContent = feed.url;
    urlSpan.title = feed.url;

    const removeButton = document.createElement("button");
    removeButton.className = "small";
    removeButton.textContent = "Remove";

    removeButton.addEventListener("click", async () => {
      await sendMessageSafe({
        type: "REMOVE_FEED",
        url: feed.url
      });

      render();
    });

    li.appendChild(nameInput);
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

  // Show only unread/new items.
  // When user clicks one, it becomes read and disappears.
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

      // Clicking marks this one item as read/cleared.
      await sendMessageSafe({
        type: "MARK_READ",
        id: item.id
      });

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

async function updateAutoMarkCheckbox() {
  const checkbox = document.getElementById("autoMarkRead");

  if (!checkbox) {
    showFatalError("Missing HTML element: #autoMarkRead");
    return;
  }

  const settings = await getSettings();
  checkbox.checked = Boolean(settings.autoMarkRead);
}

async function exportData() {
  try {
    if (!chrome || !chrome.storage || !chrome.storage.local) {
      throw new Error("chrome.storage.local is unavailable.");
    }

    const { state, settings } = await chrome.storage.local.get([
      "state",
      "settings"
    ]);

    const safeState = state || {};

    const feeds = Array.isArray(safeState.feeds)
      ? safeState.feeds.map(normalizeFeed).filter(Boolean)
      : [];

    const seen =
      safeState.seen &&
      typeof safeState.seen === "object" &&
      !Array.isArray(safeState.seen)
        ? safeState.seen
        : {};

    const backup = {
      app: "RSSuperx",
      version: 1,
      exportedAt: new Date().toISOString(),
      state: {
        feeds,
        seen
      },
      settings: settings || {
        autoMarkRead: false
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

    const feeds = Array.isArray(importedState.feeds)
      ? importedState.feeds.map(normalizeFeed).filter(Boolean)
      : [];

    const seen =
      importedState.seen &&
      typeof importedState.seen === "object" &&
      !Array.isArray(importedState.seen)
        ? importedState.seen
        : {};

    const ok = window.confirm(
      `Import ${feeds.length} feeds?\n\nThis will replace your current feed list and seen memory.`
    );

    if (!ok) {
      return;
    }

    const newState = {
      initialized: true,
      feeds,
      items: [],
      seen
    };

    await chrome.storage.local.set({ state: newState });

    if (parsed.settings && typeof parsed.settings === "object") {
      const currentSettings = await getSettings();

      const newSettings = {
        ...currentSettings,
        ...parsed.settings
      };

      await saveSettings(newSettings);
      await updateAutoMarkCheckbox();
    }

    // This updates the badge after import.
    await sendMessageSafe({ type: "MARK_ALL_READ" });

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

  const clearButton = document.getElementById("clearItems");

  if (clearButton) {
    clearButton.addEventListener("click", async () => {
      await sendMessageSafe({ type: "CLEAR_ITEMS" });
      render();
    });
  } else {
    showFatalError("Missing HTML element: #clearItems");
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

  const autoMarkCheckbox = document.getElementById("autoMarkRead");

  if (autoMarkCheckbox) {
    autoMarkCheckbox.addEventListener("change", async () => {
      const settings = await getSettings();

      settings.autoMarkRead = autoMarkCheckbox.checked;

      await saveSettings(settings);

      // If user turns auto-clear on, apply it immediately.
      if (autoMarkCheckbox.checked) {
        await sendMessageSafe({ type: "MARK_ALL_READ" });
      }

      render();
    });
  } else {
    showFatalError("Missing HTML element: #autoMarkRead");
  }
}

(async function init() {
  try {
    bindEvents();

    await updateAutoMarkCheckbox();

    const settings = await getSettings();

    if (settings.autoMarkRead) {
      await sendMessageSafe({ type: "MARK_ALL_READ" });
    }

    await render();
  } catch (error) {
    showFatalError(
      "Init error: " + ((error && error.message) || String(error))
    );
  }
})();
