async function getState() {
  const { state } = await chrome.storage.local.get("state");

  const safe = state || {};

  return {
    feeds: Array.isArray(safe.feeds) ? safe.feeds : [],
    items: Array.isArray(safe.items) ? safe.items : []
  };
}

async function render() {
  const state = await getState();

  renderFeeds(state.feeds);
  renderItems(state.items);
}

function renderFeeds(feeds) {
  const feedList = document.getElementById("feedList");
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
      await chrome.runtime.sendMessage({
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
        await chrome.tabs.create({ url: item.link });
      }

      await chrome.runtime.sendMessage({
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

  const url = input.value.trim();

  error.textContent = "";

  if (!url) {
    error.textContent = "Paste an RSS feed URL first.";
    return;
  }

  const response = await chrome.runtime.sendMessage({
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

document.getElementById("addFeed").addEventListener("click", async () => {
  await addFeedFromInput();
});

document.getElementById("feedUrl").addEventListener("keydown", async (event) => {
  if (event.key === "Enter") {
    await addFeedFromInput();
  }
});

document.getElementById("markAll").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "MARK_ALL_READ" });
  render();
});

document.getElementById("clearItems").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "CLEAR_ITEMS" });
  render();
});

// Automatically clear badge number when popup is opened.
(async () => {
  await chrome.runtime.sendMessage({ type: "MARK_ALL_READ" });
  render();
})();
