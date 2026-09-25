# RSSuperx

A minimalist, dark-themed RSS feed notifier for Chrome. 

RSSuperx is designed for people who just want to know when a website updates, without the clutter, paywalls, or complex interfaces of traditional RSS readers. It tracks your feeds in the background, shows an unread badge number on the extension icon, and lets you click-to-clear items as you read them.

## ✨ Features

- **3 Themes:** Black, Dim, Light.
- **Check Interval:** The Check every dropdown to select between 1 minute, 5 minutes, 15 minutes, 30 minutes, 1 hour.
- **Click-to-Clear:** Click an article to open it in a new tab and automatically clear it from your notification list.
- **Smart "Seen" Memory:** If you dismiss an item or clear your list, the extension remembers it. Old articles will never reappear as "new" updates.
- **Auto-Fetch Feed Names:** Leave the name field blank when adding a feed, and RSSuperx will automatically extract the site's title from the RSS/Atom XML.
- **Feed Health Status:** Green, red, and gray status dots let you know if a feed is working, broken, or hasn't been checked yet.
- **Unread Counters:** See exactly how many new items each specific feed has generated.
- **Export & Import:** Back up your subscriptions and seen-memory to a JSON file. Easily restore them if you change computers or reinstall Chrome.
- **Zero Tracking:** 100% of your data (feeds, settings, seen items) is stored locally in your browser using `chrome.storage.local`. No cloud accounts, no analytics, no telemetry.

## 🚀 Installation (Unpacked)

Since this is a personal utility extension, it is loaded directly into Chrome as an "unpacked" extension.

1. **Download the code:**
   - Click the green **Code** button at the top of this repository and select **Download ZIP**.
   - Extract the ZIP file to a permanent folder on your computer (e.g., `Documents/RSSuperx`).
   *(Note: Do not delete or move this folder after installing, or Chrome will lose access to the extension files.)*

2. **Load into Chrome:**
   - Open Chrome and navigate to `chrome://extensions/`
   - Toggle on **Developer mode** in the top right corner.
   - Click the **Load unpacked** button in the top left.
   - Select the (`RSSuperx`) folder.

3. **Pin the extension:**
   - Click the puzzle piece icon in your Chrome toolbar.
   - Find **RSSuperx** and click the pin icon so it stays visible on your toolbar.

## 📖 How to Use

### Adding a Feed
1. Click the RSSuperx icon.
2. Paste the RSS or Atom feed URL (e.g., `https://gogetasuperx.github.io/Steam-Games-GogetaSuperx/rss.xml`).
3. *(Optional)* Type a custom name. If you leave it blank, RSSuperx will grab the official feed title automatically.
4. Click **Add feed**.

### Reading & Clearing
- When the badge number shows new items, click the extension icon.
- Click any article title to open it in a new tab. It will instantly disappear from the list and the badge number will decrease.
- If you just want to ignore everything, click the **Dismiss all** button at the top.

### Managing Feeds
- **Rename:** Click the text box next to any feed and type a new name. It saves automatically when you click away.
- **Remove:** Click the **Remove** button. You will be asked to confirm before the feed is deleted.

### Backing up your data
Because this is an unpacked extension, moving the folder or clearing your browser data can wipe your subscriptions. Use the backup feature!
- **Export:** Click **Export** to download a `.json` file containing your feeds and history.
- **Import:** Click **Import** and select your `.json` file to restore your setup.

## 🔒 Permissions Explained

- **`<all_urls>`**: Required so the extension can fetch RSS/Atom XML files from any website you choose to subscribe to.
- **`storage`**: Used to save your feed list, settings, and "seen" memory locally on your device.
- **`alarms`**: Used to wake up the background script periodically (every 1 minute) to check your feeds for new updates.

## 🛠️ Tech Stack

- Vanilla JavaScript (No heavy frameworks)
- Manifest V3
- Pure CSS Dark Theme
