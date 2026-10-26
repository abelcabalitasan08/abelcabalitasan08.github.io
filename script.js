/* =========================================================
   CLASS CHAT — Supabase client and configuration
   Keep the publishable/anon key in the browser only.
   NEVER put a Supabase service_role key in this file.
========================================================= */
const SUPABASE_URL = "https://ounqhurlycwgngyvxkll.supabase.co";
const SUPABASE_KEY = "sb_publishable_2RBbbIj6-Wc2cRdqZWhWSw_r9vP8XMH";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (id) => document.getElementById(id);
const authScreen = $("auth-screen");
const chatScreen = $("chat-screen");
const authForm = $("auth-form");
const authMessage = $("auth-message");
const displayName = $("display-name");
const emailInput = $("email");
const passwordInput = $("password");
const signupBtn = $("signup-btn");
const logoutBtn = $("logout-btn");
const who = $("who");
const messageList = $("messages");
const messageForm = $("message-form");
const messageInput = $("message-input");
const sendBtn = $("send-btn");
const onlineElement = $("online-users");
const onlineCount = $("online-count");
const typingElement = $("typing-indicator");
const themeToggle = $("theme-toggle");

let currentUser = null;
let channel = null;
let presenceChannel = null;
let startingChat = false;
let typingTimer = null;
const names = Object.create(null);
const typingUsers = new Map();

const THEME_KEY = "class-chat-theme";
function applyTheme(theme) {
  const chosen = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = chosen;
  themeToggle.textContent = chosen === "dark" ? "☀️" : "🌙";
  themeToggle.setAttribute("aria-label", chosen === "dark" ? "Switch to light mode" : "Switch to dark mode");
  themeToggle.title = chosen === "dark" ? "Switch to light mode" : "Switch to dark mode";
}
try {
  const savedTheme = localStorage.getItem(THEME_KEY);
  applyTheme(savedTheme || "dark");
} catch { applyTheme("dark"); }
themeToggle.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch {}
});

function getDisplayName(user) {
  return names[user.id] || user.user_metadata?.display_name || user.email?.split("@")[0] || "Classmate";
}
function initials(name) {
  return String(name || "?").trim().split(/\s+/).slice(0, 2).map(part => part[0] || "").join("").toUpperCase() || "?";
}
function explainDbError(action, error) {
  console.error(`${action} error:`, error);
  const message = error?.message || "Unknown database error";
  if (/permission denied|row-level security|violates row-level security|not allowed/i.test(message)) {
    alert(`${action} was blocked by Supabase permissions.\n\nRLS is still enabled. Check the ${action.toLowerCase()} policy on public.messages and confirm it allows the signed-in owner (auth.uid() = user_id). Do not disable RLS or use a service-role key in the browser.\n\nSupabase says: ${message}`);
  } else {
    alert(`${action} failed: ${message}`);
  }
}
function scrollToLatest() { messageList.scrollTop = messageList.scrollHeight; }
function showEmptyState() {
  if (messageList.children.length) return;
  const empty = document.createElement("li");
  empty.className = "empty-state";
  empty.textContent = "No messages yet. Start the conversation with your class!";
  messageList.appendChild(empty);
}
function removeEmptyState() {
  const empty = messageList.querySelector(".empty-state");
  if (empty) empty.remove();
}

/* ---------------- Authentication ---------------- */
async function signUp() {
  const name = displayName.value.trim();
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (name.length < 2 || name.length > 24) {
    authMessage.textContent = "Display name must be 2 to 24 characters.";
    return;
  }
  if (!email || password.length < 8) {
    authMessage.textContent = "Enter your email and a password with at least 8 characters.";
    return;
  }
  authMessage.textContent = "Creating your account…";
  signupBtn.disabled = true;
  try {
    const { data, error } = await sb.auth.signUp({
      email, password, options: { data: { display_name: name } }
    });
    if (error) authMessage.textContent = error.message;
    else if (!data.session) authMessage.textContent = "Account created. Check your email to confirm, then log in.";
    else authMessage.textContent = "Account created successfully.";
  } catch (error) {
    console.error(error);
    authMessage.textContent = "Something went wrong during signup.";
  } finally { signupBtn.disabled = false; }
}
async function logIn() {
  authMessage.textContent = "Logging in…";
  try {
    const { error } = await sb.auth.signInWithPassword({
      email: emailInput.value.trim(), password: passwordInput.value
    });
    authMessage.textContent = error ? error.message : "";
  } catch (error) {
    console.error(error);
    authMessage.textContent = "Unable to log in right now.";
  }
}
authForm.addEventListener("submit", (event) => {
  event.preventDefault();
  logIn();
});
signupBtn.addEventListener("click", () => {
  if (authForm.reportValidity()) signUp();
});
logoutBtn.addEventListener("click", async () => {
  logoutBtn.disabled = true;
  try {
    const { error } = await sb.auth.signOut();
    if (error) alert("Logout failed: " + error.message);
  } finally { logoutBtn.disabled = false; }
});

sb.auth.onAuthStateChange((event, session) => {
  const user = session?.user || null;
  setTimeout(() => {
    if (user && (!currentUser || currentUser.id !== user.id)) startChat(user);
    else if (!user && currentUser) stopChat();
  }, 0);
});

/* ---------------- Chat lifecycle ---------------- */
async function startChat(user) {
  if (startingChat) return;
  startingChat = true;
  currentUser = user;
  authScreen.hidden = true;
  chatScreen.hidden = false;
  who.textContent = getDisplayName(user);
  try {
    await loadNames();
    if (!currentUser || currentUser.id !== user.id) return;
    who.textContent = getDisplayName(user);
    await loadMessages();
    if (!currentUser || currentUser.id !== user.id) return;
    listenForChatEvents();
    await startOnlineUsers();
    messageInput.focus();
  } catch (error) {
    console.error("Could not start chat:", error);
  } finally { startingChat = false; }
}
function stopChat() {
  currentUser = null;
  startingChat = false;
  if (channel) { sb.removeChannel(channel); channel = null; }
  if (presenceChannel) { sb.removeChannel(presenceChannel); presenceChannel = null; }
  if (typingTimer) clearTimeout(typingTimer);
  typingUsers.clear();
  updateTypingIndicator();
  messageList.replaceChildren();
  onlineElement.replaceChildren();
  onlineElement.textContent = "You're offline";
  onlineCount.textContent = "0 online";
  passwordInput.value = "";
  chatScreen.hidden = true;
  authScreen.hidden = false;
}

/* ---------------- Profiles and messages ---------------- */
async function loadNames() {
  const { data, error } = await sb.from("profiles").select("id, display_name");
  if (error) {
    console.error("Profile loading error:", error.message);
    return;
  }
 
async function loadNames() {
  const { data, error } = await sb
    .from("profiles")
    .select("id, display_name");

  if (error) {
    console.error("Profile loading error:", error.message);
    return;
  }

  (data || []).forEach(profile => {
    if (profile.display_name && profile.display_name.trim()) {
      names[profile.id] = profile.display_name.trim();
    }
  });

  console.log("Loaded profile names:", names);
}

}
async function nameFor(userId) {
  if (names[userId]) return names[userId];
  const { data, error } = await sb.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  if (error) console.error("Name loading error:", error.message);
  names[userId] = data?.display_name || "Classmate";
  return names[userId];
}
async function loadMessages() {
  // updated_at is intentionally omitted because it is not present in the current schema.
  const { data, error } = await sb.from("messages")
    .select("id, user_id, content, created_at")
    .order("created_at", { ascending: false }).limit(50);
  if (error) {
    explainDbError("Load messages", error);
    return;
  }
  messageList.replaceChildren();
  for (const msg of (data || []).reverse()) {
    await nameFor(msg.user_id);
    showMessage(msg);
  }
  showEmptyState();
}

/* Close open menus when the user clicks elsewhere or presses Escape. */
function closeMessageMenus(exceptMenu = null) {
  document.querySelectorAll(".message-menu").forEach(menu => {
    if (menu === exceptMenu) return;
    menu.hidden = true;
    const toggle = menu.parentElement?.querySelector(".message-menu-toggle");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  });
}
document.addEventListener("click", (event) => {
  if (event.target.closest(".message-actions")) return;
  closeMessageMenus();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMessageMenus();
});

function createMessageActions(msg, text, item) {
  const actions = document.createElement("div");
  actions.className = "message-actions";

  const menuButton = document.createElement("button");
  menuButton.type = "button";
  menuButton.className = "message-menu-toggle";
  menuButton.textContent = "⋮";
  menuButton.setAttribute("aria-label", "Message options");
  menuButton.setAttribute("aria-haspopup", "true");
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.title = "Message options";

  const menu = document.createElement("div");
  menu.className = "message-menu";
  menu.hidden = true;

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "edit-btn";
  editBtn.textContent = "Edit";

  editBtn.addEventListener("click", async () => {
    menu.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
    if (!currentUser || currentUser.id !== msg.user_id) return;

    const updated = prompt("Edit your message:", text.textContent);
    if (updated === null) return;
    const newContent = updated.trim();
    if (!newContent || newContent.length > 500) {
      alert("Message must contain 1 to 500 characters.");
      return;
    }
    if (newContent === text.textContent) return;

    editBtn.disabled = true;
    try {
      // Do not select updated_at; that column does not exist in this database.
      const { data, error } = await sb.from("messages")
        .update({ content: newContent })
        .eq("id", msg.id)
        .eq("user_id", currentUser.id)
        .select("id, user_id, content, created_at")
        .maybeSingle();
      if (error) {
        explainDbError("Edit message", error);
        return;
      }
      if (!data) {
        alert("No message was updated. Check the UPDATE policy and confirm user_id matches your signed-in Supabase user.");
        return;
      }
      showMessage(data);
    } catch (error) {
      explainDbError("Edit message", error);
    } finally {
      editBtn.disabled = false;
    }
  });

  const unsendBtn = document.createElement("button");
  unsendBtn.type = "button";
  unsendBtn.className = "unsend-btn";
  unsendBtn.textContent = "Unsend";

  unsendBtn.addEventListener("click", async () => {
    menu.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
    if (!currentUser || currentUser.id !== msg.user_id) return;
    if (!confirm("Unsend this message for everyone?")) return;

    unsendBtn.disabled = true;
    try {
      const { data, error } = await sb.from("messages").delete()
        .eq("id", msg.id)
        .eq("user_id", currentUser.id)
        .select("id")
        .maybeSingle();
      if (error) {
        explainDbError("Unsend message", error);
        return;
      }
      if (!data) {
        alert("No message was deleted. Check the DELETE policy and message ownership.");
        return;
      }
      item.remove();
      showEmptyState();
    } catch (error) {
      explainDbError("Unsend message", error);
    } finally {
      unsendBtn.disabled = false;
    }
  });

  menuButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = menu.hidden;
    closeMessageMenus(menu);
    menu.hidden = !willOpen;
    menuButton.setAttribute("aria-expanded", String(willOpen));
  });

  menu.append(editBtn, unsendBtn);
  actions.append(menuButton, menu);
  return actions;
}

function showMessage(msg) {
  if (!currentUser || !msg) return;
  const selector = `[data-id="${CSS.escape(String(msg.id))}"]`;
  const existing = messageList.querySelector(selector);
  if (existing) existing.remove();
  removeEmptyState();

  const isMine = msg.user_id === currentUser.id;
  const authorName = names[msg.user_id] || "Classmate";
  const item = document.createElement("li");
  item.className = `message${isMine ? " mine" : ""}`;
  item.dataset.id = msg.id;

  const top = document.createElement("div");
  top.className = "message-top";
  const avatar = document.createElement("span");
  avatar.className = "avatar tiny";
  avatar.textContent = initials(authorName);
  avatar.setAttribute("aria-hidden", "true");
  const author = document.createElement("span");
  author.className = "author";
  author.textContent = isMine ? "You" : authorName;
  top.append(avatar, author);

  const text = document.createElement("p");
  text.className = "message-text";
  text.textContent = msg.content ?? "";

  const time = document.createElement("time");
  time.dateTime = msg.created_at || "";
  time.textContent = msg.created_at
    ? new Date(msg.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "";

  item.append(top, text, time);
  if (isMine) item.append(createMessageActions(msg, text, item));
  messageList.append(item);
  scrollToLatest();
}

/* ---------------- Send messages and weather command ---------------- */
messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) return;
  const content = messageInput.value.trim();
  if (!content || content.length > 500) return;
  if (content.startsWith("/")) {
    messageInput.value = "";
    sendTyping(false);
    await handleCommand(content);
    return;
  }
  sendBtn.disabled = true;
  try {
    // Keep the existing schema/defaults. Supabase RLS remains enabled.
    const { error } = await sb.from("messages").insert({ content });
    if (error) {
      explainDbError("Send message", error);
      return;
    }
    messageInput.value = "";
    sendTyping(false);
  } catch (error) {
    explainDbError("Send message", error);
  } finally {
    sendBtn.disabled = false;
    messageInput.focus();
  }
});

/* ---------------- Realtime messages + typing ---------------- */
function listenForChatEvents() {
  if (channel) { sb.removeChannel(channel); channel = null; }
  channel = sb.channel("class-chat", { config: { broadcast: { self: false } } })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, async payload => {
      await nameFor(payload.new.user_id);
      showMessage(payload.new);
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, async payload => {
      await nameFor(payload.new.user_id);
      showMessage(payload.new);
    })
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, payload => {
      removeMessage(payload.old.id);
    })
    .on("broadcast", { event: "typing" }, payload => {
      const data = payload.payload || {};
      if (!currentUser || data.user_id === currentUser.id) return;
      if (data.is_typing) typingUsers.set(data.user_id, data.display_name || "A classmate");
      else typingUsers.delete(data.user_id);
      updateTypingIndicator();
    })
    .subscribe(status => console.log("Chat realtime status:", status));
}
function removeMessage(id) {
  const item = messageList.querySelector(`[data-id="${CSS.escape(String(id))}"]`);
  if (item) item.remove();
  showEmptyState();
}
function sendTyping(isTyping) {
  if (!channel || !currentUser) return;
  channel.send({
    type: "broadcast",
    event: "typing",
    payload: { user_id: currentUser.id, display_name: getDisplayName(currentUser), is_typing: isTyping }
  }).catch(error => console.debug("Typing status not sent:", error));
}
function updateTypingIndicator() {
  const namesTyping = [...typingUsers.values()];
  if (!namesTyping.length) {
    typingElement.hidden = true;
    typingElement.textContent = "";
    return;
  }
  typingElement.hidden = false;
  typingElement.textContent = namesTyping.length === 1
    ? `${namesTyping[0]} is typing…`
    : `${namesTyping.slice(0, 2).join(" and ")} are typing…`;
}
messageInput.addEventListener("input", () => {
  if (!currentUser || messageInput.value.trim().startsWith("/")) return;
  sendTyping(true);
  if (typingTimer) clearTimeout(typingTimer);
  typingTimer = setTimeout(() => sendTyping(false), 1400);
});
messageInput.addEventListener("blur", () => sendTyping(false));

/* ---------------- Online presence and avatars ---------------- */
async function startOnlineUsers() {
  if (!currentUser) return;
  if (presenceChannel) { await sb.removeChannel(presenceChannel); presenceChannel = null; }
  const userAtStart = currentUser;
  presenceChannel = sb.channel("class-chat-presence", { config: { presence: { key: userAtStart.id } } });
  presenceChannel.on("presence", { event: "sync" }, () => {
    const state = presenceChannel.presenceState();
    const uniqueUsers = new Map();
    Object.values(state).flat().forEach(person => {
      if (person.user_id) uniqueUsers.set(person.user_id, person.display_name || "Classmate");
    });
    renderOnlineUsers([...uniqueUsers.entries()]);
  }).subscribe(async (status, error) => {
    console.log("Presence status:", status);
    if (status === "SUBSCRIBED" && currentUser?.id === userAtStart.id) {
      const { error: trackError } = await presenceChannel.track({
        user_id: userAtStart.id,
        display_name: getDisplayName(userAtStart),
        online_at: new Date().toISOString()
      });
      if (trackError) console.error("Presence tracking error:", trackError);
    }
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      console.error("Presence connection error:", error);
      onlineElement.textContent = "Could not load online users.";
    }
  });
}
function renderOnlineUsers(entries) {
  onlineCount.textContent = `${entries.length} online`;
  onlineElement.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No classmates online yet.";
    onlineElement.append(empty);
    return;
  }
  entries.sort((a, b) => a[1].localeCompare(b[1]));
  entries.forEach(([id, name]) => {
    const person = document.createElement("div");
    person.className = "online-person";
    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.textContent = initials(name);
    avatar.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "person-name";
    label.textContent = id === currentUser?.id ? `${name} (you)` : name;
    const dot = document.createElement("span");
    dot.className = "online-dot";
    dot.setAttribute("aria-label", "Online");
    person.append(avatar, label, dot);
    onlineElement.append(person);
  });
}

/* ---------------- Weather bot: /weather Manila ---------------- */
const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
function describeWeather(code) {
  if (code === 0) return "clear sky";
  if (code <= 3) return "partly cloudy";
  if (code <= 48) return "foggy";
  if (code <= 57) return "drizzle";
  if (code <= 67) return "rain";
  if (code <= 77) return "snow";
  if (code <= 82) return "rain showers";
  if (code <= 86) return "snow showers";
  return "thunderstorm";
}
async function getWeather(city) {
  const geoResponse = await fetch(`${GEO_URL}?name=${encodeURIComponent(city)}&count=1`);
  if (!geoResponse.ok) throw new Error("Geocoding failed");
  const geoData = await geoResponse.json();
  if (!geoData.results?.length) return `Sorry, I could not find a city named ${city}.`;
  const place = geoData.results[0];
  const weatherUrl = `${WEATHER_URL}?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,weather_code,wind_speed_10m`;
  const weatherResponse = await fetch(weatherUrl);
  if (!weatherResponse.ok) throw new Error("Weather failed");
  const now = (await weatherResponse.json()).current;
  return `${place.name}, ${place.country}: ${now.temperature_2m}°C, ${describeWeather(now.weather_code)}, wind ${now.wind_speed_10m} km/h.`;
}
async function handleCommand(command) {
  const words = command.trim().split(/\s+/);
  if (words[0].toLowerCase() !== "/weather") {
    showBotMessage("Unknown command. Try: /weather Manila");
    return;
  }
  const city = words.slice(1).join(" ").trim();
  if (!city) {
    showBotMessage("Try it like this: /weather Manila");
    return;
  }
  showBotMessage(`Checking weather for ${city}…`);
  const pending = messageList.lastElementChild;
  try {
    const result = await getWeather(city);
    if (pending) pending.remove();
    showBotMessage(result);
  } catch (error) {
    console.error(error);
    if (pending) pending.remove();
    showBotMessage("The weather service is not answering right now.");
  }
}
function showBotMessage(text) {
  removeEmptyState();
  const item = document.createElement("li");
  item.className = "message bot";
  const top = document.createElement("div");
  top.className = "message-top";
  const avatar = document.createElement("span");
  avatar.className = "avatar tiny";
  avatar.textContent = "☁";
  const author = document.createElement("span");
  author.className = "author";
  author.textContent = "WeatherBot · only visible to you";
  top.append(avatar, author);
  const body = document.createElement("p");
  body.textContent = text;
  item.append(top, body);
  messageList.append(item);
  scrollToLatest();
}

/* Recover an existing session on page refresh. */
(async () => {
  const { data, error } = await sb.auth.getSession();
  if (error) console.error("Session restore error:", error.message);
  if (data?.session?.user && !currentUser) startChat(data.session.user);
})();
