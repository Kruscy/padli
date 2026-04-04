/* ===== CHAT WIDGET ===== */

const WS_URL = `wss://${location.hostname}/ws`;
let ws = null;
let isOpen = false;
let messages = [];
let currentUser = null;
let guildEmojis = [];

function initChat() {
  if (document.getElementById("chatWidget")) return;

  const interval = setInterval(() => {
    if (window.currentUser) {
      clearInterval(interval);
      currentUser = window.currentUser;
      createWidget();
      setTimeout(() => {
        loadHistory();
        loadEmojis();
        connectWS();
      }, 100);
    }
  }, 100);
}

function createWidget() {
  const widget = document.createElement("div");
  widget.id = "chatWidget";
  widget.innerHTML = `
    <button id="chatBubble">
      🍆
      <span id="chatBadge" class="chat-badge hidden">0</span>
    </button>
    <div id="chatDialogBox" class="chat-dialog-box hidden">
      <div class="chat-header">
        <span>💬 Társalgó</span>
        <button id="chatCloseBtn" class="chat-close">✕</button>
      </div>
      <div id="chatMessages" class="chat-messages"></div>
      <div id="emojiPicker" class="emoji-picker hidden"></div>
      <div class="chat-input-row">
        <button id="chatEmojiBtn" class="chat-emoji-btn">😊</button>
        <input id="chatInput" type="text" placeholder="Üzenet..." maxlength="500">
        <button id="chatSendBtn">➤</button>
      </div>
    </div>
  `;
  document.body.appendChild(widget);

  document.getElementById("chatBubble").addEventListener("click", toggleChat);
  document.getElementById("chatCloseBtn").addEventListener("click", toggleChat);
  document.getElementById("chatSendBtn").addEventListener("click", sendChatMsg);
  document.getElementById("chatInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendChatMsg();
  });
  document.getElementById("chatEmojiBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    const picker = document.getElementById("emojiPicker");
    picker.classList.toggle("hidden");
  });
  document.addEventListener("click", () => {
    document.getElementById("emojiPicker")?.classList.add("hidden");
  });
  document.getElementById("emojiPicker")?.addEventListener("click", (e) => {
    e.stopPropagation();
  });
}

async function loadEmojis() {
  try {
    const res = await fetch("/api/chat/emojis");
    if (!res.ok) return;
    guildEmojis = await res.json();
    renderEmojiPicker();
  } catch {}
}

function renderEmojiPicker() {
  const picker = document.getElementById("emojiPicker");
  if (!picker) return;
  picker.innerHTML = "";

  guildEmojis.forEach(e => {
    const img = document.createElement("img");
    img.src = e.url;
    img.title = `:${e.name}:`;
    img.className = "emoji-picker-item";
    img.addEventListener("click", () => {
      const input = document.getElementById("chatInput");
      input.value += `:${e.name}:`;
      input.focus();
      document.getElementById("emojiPicker").classList.add("hidden");
    });
    picker.appendChild(img);
  });
}

function toggleChat() {
  isOpen = !isOpen;
  const box = document.getElementById("chatDialogBox");
  const badge = document.getElementById("chatBadge");

  if (isOpen) {
    box.classList.remove("hidden");
    badge.classList.add("hidden");
    badge.textContent = "0";
    unreadCount = 0;
    document.getElementById("chatInput")?.focus();
    scrollToBottom();
  } else {
    box.classList.add("hidden");
    document.getElementById("emojiPicker")?.classList.add("hidden");
  }
}

let unreadCount = 0;

function connectWS() {
  ws = new WebSocket(WS_URL);

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "message") {
      addMessage(data);
      if (!isOpen) {
        unreadCount++;
        const badge = document.getElementById("chatBadge");
        badge.textContent = unreadCount;
        badge.classList.remove("hidden");
      }
    }
  };

  ws.onclose = () => {
    setTimeout(connectWS, 3000);
  };
}

async function loadHistory() {
  await new Promise(resolve => {
    const check = setInterval(() => {
      if (document.getElementById("chatMessages")) {
        clearInterval(check);
        resolve();
      }
    }, 50);
  });

  try {
    const res = await fetch("/api/chat/history");
    if (!res.ok) return;
    const data = await res.json();
    data.forEach(msg => addMessage({
      type: "message",
      source: msg.source,
      author: msg.author,
      displayName: msg.display_name || msg.author,
      authorId: msg.author_id,
      avatar: msg.avatar,
      content: msg.content,
      timestamp: new Date(msg.created_at).getTime()
    }));
  } catch {}
}

function formatContent(content) {
  let safe = escapeHtml(content);

  safe = safe.replace(
    /(https?:\/\/[^\s&]+)/g,
    '<a href="$1" target="_blank" rel="noopener" style="color:#a78bfa; word-break:break-all; text-decoration:underline;">$1</a>'
  );

  safe = safe.replace(
    /&lt;:[a-zA-Z0-9_]+:(\d+)&gt;/g,
    (match, id) => `<img src="https://cdn.discordapp.com/emojis/${id}.webp?size=20" class="chat-emoji-inline">`
  );

  safe = safe.replace(/:([a-zA-Z0-9_]+):/g, (match, name) => {
    const emoji = guildEmojis.find(e => e.name === name);
    if (emoji) {
      return `<img src="${emoji.url}" class="chat-emoji-inline" title=":${name}:">`;
    }
    return match;
  });

  return safe;
}

function addMessage(data) {
  messages.push(data);
  if (messages.length > 100) messages.shift();

  const box = document.getElementById("chatMessages");
  if (!box) return;

  const isMe = data.source === "web" && data.authorId === currentUser?.id;
  const isDiscord = data.source === "discord";
  const displayName = data.displayName || data.globalName || data.author;

  const div = document.createElement("div");
  div.className = `chat-msg ${isMe ? "chat-msg-me" : "chat-msg-other"}`;

  div.innerHTML = `
    <div class="chat-msg-header">
      <img src="${data.avatar || '/uploads/default.png'}" class="chat-avatar">
      <span class="chat-name ${isDiscord ? 'chat-discord' : ''}">${isDiscord ? '🎮 ' : ''}${escapeHtml(displayName)}</span>
      <span class="chat-time">${formatTime(data.timestamp)}</span>
    </div>
    <div class="chat-msg-content">${formatContent(data.content)}</div>
  `;

  box.appendChild(div);
  scrollToBottom();
}

function scrollToBottom() {
  const box = document.getElementById("chatMessages");
  if (box) box.scrollTop = box.scrollHeight;
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendChatMsg() {
  const input = document.getElementById("chatInput");
  const content = input.value.trim();
  if (!content) return;

  input.value = "";

  let discordContent = content;
  guildEmojis.forEach(e => {
    discordContent = discordContent.replaceAll(`:${e.name}:`, `<:${e.name}:${e.id}>`);
  });

  try {
    await fetch("/api/chat/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: discordContent })
    });
  } catch (err) {
    console.error("Chat send error:", err);
  }
}
