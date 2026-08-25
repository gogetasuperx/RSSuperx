async function getState() {
  const { state } = await chrome.storage.local.get("state");

  return state || {
    initialized: false,
    items: []
  };
}

async function render() {
  const state = await getState();
  const list = document.getElementById("list");

  list.innerHTML = "";

  const unread = state.items.filter((item) => !item.read);
  const read = state.items.filter((item) => item.read).slice(0, 30);

  const items = [...unread, ...read].slice(0, 100);

  if (items.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No RSS items yet.";
    list.appendChild(li);
    return;
  }

  for (const item of items) {
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

document.getElementById("markAll").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "MARK_ALL_READ" });
  render();
});

(async () => {
  await chrome.runtime.sendMessage({ type: "MARK_ALL_READ" });
  render();
})();
