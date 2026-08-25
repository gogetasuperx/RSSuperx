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

async function getState() {
  try {
    if (
      !chrome ||
      !chrome.storage ||
      !chrome.storage.local
    ) {
      throw new Error("chrome.storage.local is unavailable.");
    }

    const { state } = await chrome.storage.local.get("state");

    const safe = state || {};

    return {
      feeds: Array.isArray(safe.feeds) ? safe.feeds : [],
      items: Array.isArray(safe.items) ? safe.items : []
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
    renderItems(state.items);
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

  for (const url of feeds) {
    const li = document.createElement("li");
    li.className = "feed-item";

    const span = document.createElement("span");
    span.className = "feed-url";
    span.textContent = url;
    span.title = url;

    const removeButton = document.createElement("button");
    removeButton.className = "small";
    removeButton.textContent = "Remove";

    removeButton.addEventListener("click", async () => {
      await sendMessageSafe({
        type: "REMOVE_FEED",
        url
      });

      render();
    });

    li.appendChild(span);
    li.appendChild(removeButton);
    feedList.appendChild(li);
  }
}

function renderItems(items) {
  const list = document.getElementById("list");

  if (!list) {
    showFatalError("Missing HTML element: #list");
    return;
  }

  list.innerHTML = "";

  const unread = items.filter((item) => !item.read);
  const read = items.filter((item) => item.read).slice(0, 30);

  const visibleItems = [...unread, ...read].slice(0, 100);

  if (visibleItems.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No RSS items yet.";
    list.appendChild(li);
    return;
  }

  for (const item of visibleItems) {
    const li = document.createElement("li");

    if (!item.read) {
      li.className = "unread";
    }

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

      await sendMessageSafe({
        type: "MARK_READ",
        id: item.id
      });

      render();
    });

    const meta = document.createElement("div");
    meta.className = "meta";

    meta.textContent = `${item.read ? "Read" : "New"} • ${new Date(
      item.addedAt
    ).toLocaleString()}`;

    li.appendChild(a);
    li.appendChild(meta);
    list.appendChild(li);
  }
}

async function addFeedFromInput() {
  const input = document.getElementById("feedUrl");
  const error = document.getElementById("feedError");

  if (!input || !error) {
    showFatalError("Missing HTML element: #feedUrl or #feedError");
    return;
  }

  const url = input.value.trim();

  error.textContent = "";

  if (!url) {
    error.textContent = "Paste an RSS feed URL first.";
    return;
  }

  const response = await sendMessageSafe({
    type: "ADD_FEED",
    url
  });

  if (!response || !response.ok) {
    error.textContent =
      (response && response.error) || "Could not add feed.";
    return;
  }

  input.value = "";
  render();
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

  const input = document.getElementById("feedUrl");

  if (input) {
    input.addEventListener("keydown", async (event) => {
      if (event.key === "Enter") {
        await addFeedFromInput();
      }
    });
  }

  const markAllButton = document.getElementById("markAll");

  if (markAllButton) {
    markAllButton.addEventListener("click", async () => {
      await sendMessageSafe({ type: "MARK_ALL_READ" });
      render();
    });
  } else {
    showFatalError("Missing HTML element: #markAll");
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
}

(async function init() {
  try {
    bindEvents();

    // Automatically clear badge when popup opens.
    await sendMessageSafe({ type: "MARK_ALL_READ" });

    await render();
  } catch (error) {
    showFatalError(
      "Init error: " + ((error && error.message) || String(error))
    );
  }
})();
