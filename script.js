
/* =====================================================
   1. SUPABASE CONNECTION
===================================================== */

const SUPABASE_URL = "https://ounqhurlycwgngyvxkll.supabase.co";
const SUPABASE_KEY = "sb_publishable_2RBbbIj6-Wc2cRdqZWhWSw_r9vP8XMH";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);


/* =====================================================
   2. HTML ELEMENTS
===================================================== */

const authScreen = document.getElementById("auth-screen");
const chatScreen = document.getElementById("chat-screen");
const authForm = document.getElementById("auth-form");
const authMessage = document.getElementById("auth-message");

const displayName = document.getElementById("display-name");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");

const signupBtn = document.getElementById("signup-btn");
const logoutBtn = document.getElementById("logout-btn");

const who = document.getElementById("who");
const messageList = document.getElementById("messages");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");

const onlineElement = document.getElementById("online-users");


/* =====================================================
   3. APP VARIABLES
===================================================== */

let currentUser = null;
let channel = null;
let presenceChannel = null;

const names = {};

let startingChat = false;


/* =====================================================
   4. SIGN UP
===================================================== */

async function signUp() {
  const name = displayName.value.trim();
  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (name.length < 2 || name.length > 24) {
    authMessage.textContent =
      "Display name must be 2 to 24 characters.";
    return;
  }

  if (!email || !password) {
    authMessage.textContent =
      "Please enter your email and password.";
    return;
  }

  authMessage.textContent = "Creating your account...";
  signupBtn.disabled = true;

  try {
    const { data, error } = await sb.auth.signUp({
      email: email,
      password: password,
      options: {
        data: {
          display_name: name
        }
      }
    });

    if (error) {
      authMessage.textContent = error.message;
    } else if (!data.session) {
      authMessage.textContent =
        "Account created! Please check your email to confirm.";
    } else {
      authMessage.textContent = "Account created successfully!";
    }
  } catch (error) {
    console.error(error);
    authMessage.textContent = "Something went wrong during signup.";
  } finally {
    signupBtn.disabled = false;
  }
}


/* =====================================================
   5. LOG IN
===================================================== */

async function logIn() {
  authMessage.textContent = "Logging in...";

  try {
    const { error } = await sb.auth.signInWithPassword({
      email: emailInput.value.trim(),
      password: passwordInput.value
    });

    if (error) {
      authMessage.textContent = error.message;
    } else {
      authMessage.textContent = "";
    }
  } catch (error) {
    console.error(error);
    authMessage.textContent = "Unable to log in.";
  }
}


/* =====================================================
   6. AUTH BUTTON EVENTS
===================================================== */

authForm.addEventListener("submit", (event) => {
  event.preventDefault();
  logIn();
});

signupBtn.addEventListener("click", () => {
  if (authForm.reportValidity()) {
    signUp();
  }
});

logoutBtn.addEventListener("click", async () => {
  logoutBtn.disabled = true;

  try {
    const { error } = await sb.auth.signOut();

    if (error) {
      alert("Logout failed: " + error.message);
    }
  } finally {
    logoutBtn.disabled = false;
  }
});


/* =====================================================
   7. AUTH STATE LISTENER
===================================================== */

sb.auth.onAuthStateChange((event, session) => {
  const user = session?.user || null;

  setTimeout(() => {
    if (user && (!currentUser || currentUser.id !== user.id)) {
      startChat(user);
    } else if (!user && currentUser) {
      stopChat();
    }
  }, 0);
});


/* =====================================================
   8. START CHAT
===================================================== */

async function startChat(user) {
  if (startingChat) return;

  startingChat = true;
  currentUser = user;

  authScreen.hidden = true;
  chatScreen.hidden = false;
  who.textContent = "Loading...";

  try {
    await loadNames();

    if (!currentUser || currentUser.id !== user.id) return;

    who.textContent =
      names[user.id] ||
      user.user_metadata?.display_name ||
      "Signed in";

    await loadMessages();

    if (!currentUser || currentUser.id !== user.id) return;

    listenForNewMessages();
    await startOnlineUsers();

    messageInput.focus();
  } catch (error) {
    console.error("Could not start chat:", error);
  } finally {
    startingChat = false;
  }
}


/* =====================================================
   9. STOP CHAT
===================================================== */

function stopChat() {
  currentUser = null;
  startingChat = false;

  if (channel) {
    sb.removeChannel(channel);
    channel = null;
  }

  if (presenceChannel) {
    sb.removeChannel(presenceChannel);
    presenceChannel = null;
  }

  messageList.innerHTML = "";

  if (onlineElement) {
    onlineElement.textContent = "Online users: 0";
  }

  passwordInput.value = "";

  chatScreen.hidden = true;
  authScreen.hidden = false;
}


/* =====================================================
   10. LOAD PROFILES
===================================================== */

async function loadNames() {
  const { data, error } = await sb
    .from("profiles")
    .select("id, display_name");

  if (error) {
    console.error("Profile loading error:", error.message);
    return;
  }

  data.forEach((profile) => {
    names[profile.id] = profile.display_name || "Unknown";
  });
}


/* =====================================================
   11. GET DISPLAY NAME
===================================================== */

async function nameFor(userId) {
  if (names[userId]) return names[userId];

  const { data, error } = await sb
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("Name loading error:", error.message);
  }

  names[userId] =
    data?.display_name || "Unknown";

  return names[userId];
}


/* =====================================================
   12. LOAD MESSAGES
===================================================== */

async function loadMessages() {
  const { data, error } = await sb
    .from("messages")
    .select("id, user_id, content, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("Message loading error:", error.message);
    return;
  }

  messageList.innerHTML = "";

  for (const msg of data.reverse()) {
    await nameFor(msg.user_id);
    showMessage(msg);
  }
}


/* =====================================================
   13. DISPLAY MESSAGE
   Includes EDIT and UNSEND buttons
===================================================== */

function showMessage(msg) {
  if (!currentUser) return;

  const selector =
    '[data-id="' + CSS.escape(String(msg.id)) + '"]';

  const existing = messageList.querySelector(selector);

  if (existing) {
    existing.remove();
  }

  const isMine = msg.user_id === currentUser.id;

  const item = document.createElement("li");
  item.className = isMine ? "message mine" : "message";
  item.dataset.id = msg.id;

  const author = document.createElement("span");
  author.className = "author";
  author.textContent = names[msg.user_id] || "Unknown";

  const text = document.createElement("p");
  text.className = "message-text";
  text.textContent = msg.content;

  const time = document.createElement("time");
  time.textContent = new Date(msg.created_at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });

  item.append(author, text, time);

  /* EDIT AND UNSEND ARE AVAILABLE ONLY ON YOUR MESSAGES */

  if (isMine) {
    const actions = document.createElement("div");
    actions.className = "message-actions";

    /* EDIT BUTTON */

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "edit-btn";
    editBtn.textContent = "Edit";

    editBtn.addEventListener("click", async () => {
      if (!currentUser || currentUser.id !== msg.user_id) return;

      const updated = prompt(
        "Edit your message:",
        text.textContent
      );

      if (updated === null) return;

      const newContent = updated.trim();

      if (!newContent) {
        alert("Message cannot be empty.");
        return;
      }

      if (newContent === text.textContent) return;

      editBtn.disabled = true;

      try {
        const { data, error } = await sb
          .from("messages")
          .update({ content: newContent })
          .eq("id", msg.id)
          .eq("user_id", currentUser.id)
          .select("id, user_id, content, created_at")
          .maybeSingle();

        if (error) {
          alert("Could not edit: " + error.message);
          return;
        }

        if (!data) {
          alert(
            "Message was not updated. Check your Supabase UPDATE policy."
          );
          return;
        }

        text.textContent = data.content;
      } catch (error) {
        console.error(error);
        alert("An unexpected error occurred while editing.");
      } finally {
        editBtn.disabled = false;
      }
    });


    /* UNSEND BUTTON */

    const unsendBtn = document.createElement("button");
    unsendBtn.type = "button";
    unsendBtn.className = "unsend-btn";
    unsendBtn.textContent = "Unsend";

    unsendBtn.addEventListener("click", async () => {
      if (!currentUser || currentUser.id !== msg.user_id) return;

      if (!confirm("Are you sure you want to unsend this message?")) {
        return;
      }

      unsendBtn.disabled = true;

      try {
        const { data, error } = await sb
          .from("messages")
          .delete()
          .eq("id", msg.id)
          .eq("user_id", currentUser.id)
          .select("id")
          .maybeSingle();

        if (error) {
          alert("Could not unsend: " + error.message);
          return;
        }

        if (!data) {
          alert(
            "Message was not deleted. Check your Supabase DELETE policy."
          );
          return;
        }

        item.remove();
      } catch (error) {
        console.error(error);
        alert("An unexpected error occurred while unsending.");
      } finally {
        unsendBtn.disabled = false;
      }
    });

    actions.append(editBtn, unsendBtn);
    item.appendChild(actions);
  }

  messageList.appendChild(item);
  messageList.scrollTop = messageList.scrollHeight;
}


/* =====================================================
   14. SEND MESSAGE
===================================================== */

messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser) return;

  const content = messageInput.value.trim();

  if (!content) return;

  /* WEATHER BOT COMMAND */

  if (content.startsWith("/")) {
    messageInput.value = "";
    handleCommand(content);
    return;
  }

  messageInput.disabled = true;

  try {
    const { error } = await sb
      .from("messages")
      .insert({ content: content });

    if (error) {
      alert("Could not send: " + error.message);
      return;
    }

    messageInput.value = "";
  } catch (error) {
    console.error(error);
    alert("Unable to send your message.");
  } finally {
    messageInput.disabled = false;
    messageInput.focus();
  }
});


/* =====================================================
   15. REALTIME CHAT
===================================================== */

function listenForNewMessages() {
  if (channel) {
    sb.removeChannel(channel);
    channel = null;
  }

  channel = sb
    .channel("class-chat")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages"
      },
      async (payload) => {
        await nameFor(payload.new.user_id);
        showMessage(payload.new);
      }
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "messages"
      },
      async (payload) => {
        await nameFor(payload.new.user_id);
        showMessage(payload.new);
      }
    )
    .on(
      "postgres_changes",
      {
        event: "DELETE",
        schema: "public",
        table: "messages"
      },
      (payload) => {
        removeMessage(payload.old.id);
      }
    )
    .subscribe((status) => {
      console.log("Chat Realtime status:", status);
    });
}


/* =====================================================
   16. REMOVE MESSAGE FROM SCREEN
===================================================== */

function removeMessage(id) {
  const item = messageList.querySelector(
    '[data-id="' + CSS.escape(String(id)) + '"]'
  );

  if (item) item.remove();
}


/* =====================================================
   17. ONLINE USERS
   Shows names of connected users
===================================================== */

async function startOnlineUsers() {
  if (!currentUser) return;

  if (presenceChannel) {
    await sb.removeChannel(presenceChannel);
    presenceChannel = null;
  }

  const userAtStart = currentUser;

  presenceChannel = sb.channel("class-chat-presence", {
    config: {
      presence: {
        key: userAtStart.id
      }
    }
  });

  presenceChannel
    .on("presence", { event: "sync" }, () => {
      const state = presenceChannel.presenceState();
      const users = Object.values(state).flat();

      const uniqueUsers = new Map();

      users.forEach((user) => {
        if (user.user_id) {
          uniqueUsers.set(
            user.user_id,
            user.display_name || "Unknown"
          );
        }
      });

      if (onlineElement) {
        const onlineNames = [...uniqueUsers.values()];

        onlineElement.textContent =
          "Online (" + onlineNames.length + "): " +
          onlineNames.join(", ");
      }
    })
    .subscribe(async (status, error) => {
      console.log("Presence status:", status);

      if (
        status === "SUBSCRIBED" &&
        currentUser?.id === userAtStart.id
      ) {
        const { error: trackError } =
          await presenceChannel.track({
            user_id: userAtStart.id,
            display_name:
              names[userAtStart.id] ||
              userAtStart.user_metadata?.display_name ||
              "User",
            online_at: new Date().toISOString()
          });

        if (trackError) {
          console.error("Presence tracking error:", trackError);
        }
      }

      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error("Presence connection error:", error);

        if (onlineElement) {
          onlineElement.textContent =
            "Unable to load online users.";
        }
      }
    });
}


/* =====================================================
   18. WEATHER BOT
===================================================== */

const GEO_URL =
  "https://geocoding-api.open-meteo.com/v1/search";

const WEATHER_URL =
  "https://api.open-meteo.com/v1/forecast";


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
  const geoUrl =
    GEO_URL + "?name=" + encodeURIComponent(city) + "&count=1";

  const geoResponse = await fetch(geoUrl);

  if (!geoResponse.ok) {
    throw new Error("Geocoding failed");
  }

  const geoData = await geoResponse.json();

  if (!geoData.results || geoData.results.length === 0) {
    return "Sorry, I could not find a city named " + city + ".";
  }

  const place = geoData.results[0];

  const weatherUrl =
    WEATHER_URL +
    "?latitude=" + place.latitude +
    "&longitude=" + place.longitude +
    "&current=temperature_2m,weather_code,wind_speed_10m";

  const weatherResponse = await fetch(weatherUrl);

  if (!weatherResponse.ok) {
    throw new Error("Weather failed");
  }

  const weatherData = await weatherResponse.json();
  const now = weatherData.current;

  return (
    place.name + ", " + place.country + ": " +
    now.temperature_2m + " degrees C, " +
    describeWeather(now.weather_code) + ", wind " +
    now.wind_speed_10m + " km/h"
  );
}


/* =====================================================
   19. WEATHER COMMAND
===================================================== */

async function handleCommand(text) {
  const words = text.trim().split(/\s+/);

  if (words[0].toLowerCase() !== "/weather") {
    showBotMessage("Unknown command. Try: /weather Manila");
    return;
  }

  const city = words.slice(1).join(" ").trim();

  if (!city) {
    showBotMessage("Try it like this: /weather Manila");
    return;
  }

  try {
    const result = await getWeather(city);
    showBotMessage(result);
  } catch (error) {
    console.error(error);

    showBotMessage(
      "The weather service is not answering right now."
    );
  }
}


/* =====================================================
   20. DISPLAY WEATHER BOT MESSAGE
===================================================== */

function showBotMessage(text) {
  const item = document.createElement("li");
  item.className = "message bot";

  const author = document.createElement("span");
  author.className = "author";
  author.textContent = "WeatherBot (only you can see this)";

  const body = document.createElement("p");
  body.textContent = text;

  item.append(author, body);
  messageList.appendChild(item);

  messageList.scrollTop = messageList.scrollHeight;
}
