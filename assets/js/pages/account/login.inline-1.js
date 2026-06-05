const HUG_USER_KEY = "hug:user";
const DEFAULT_MEMBER_EMAIL = "yuexing@hug.claims";
const guestUser = {
  id: "guest",
  username: "guest",
  displayName: "Guest",
  avatar: "GS",
  provider: "guest",
  signedIn: true,
  isGuest: true,
};

function readHugUser() {
  try {
    return JSON.parse(localStorage.getItem(HUG_USER_KEY) || "null");
  } catch (err) {
    return null;
  }
}

function writeHugUser(user) {
  try {
    localStorage.setItem(
      HUG_USER_KEY,
      JSON.stringify({ ...user, signedInAt: new Date().toISOString() }),
    );
  } catch (err) {
    console.warn("Could not save demo user:", err);
  }
}

function clearHugUser() {
  try {
    localStorage.removeItem(HUG_USER_KEY);
  } catch (err) {
    console.warn("Could not clear demo user:", err);
  }
}

function avatarFromName(name) {
  const safe = String(name || "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .trim();
  if (!safe) return "HU";
  const parts = safe.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function usernameFromEmail(email) {
  const local = String(email || "").split("@")[0] || "";
  const cleaned = local.toLowerCase().replace(/[^a-z0-9._-]/g, "");
  return cleaned || "member";
}

function buildMemberUser(email) {
  const username = usernameFromEmail(email);
  return {
    id: `member-${username}`,
    username,
    displayName: username,
    avatar: avatarFromName(username),
    provider: "hug-local",
    signedIn: true,
    isGuest: false,
  };
}

function renderProfile() {
  const user = readHugUser();
  const signedIn = Boolean(user && user.signedIn);
  const isGuest = Boolean(user && user.isGuest);
  const card = document.getElementById("demoProfile");
  const avatar = document.getElementById("profileAvatar");
  const title = document.getElementById("profileTitle");
  const subtitle = document.getElementById("profileSubtitle");
  const action = document.getElementById("profileAction");
  const signOut = document.getElementById("demoSignOut");
  const status = document.getElementById("loginStatus");

  card.classList.toggle("signed", signedIn);
  card.setAttribute("aria-pressed", signedIn ? "true" : "false");
  avatar.textContent = signedIn ? user.avatar || "HU" : "HU";
  title.textContent = signedIn
    ? `Signed in as ${user.username || "member"}`
    : "No active account";
  subtitle.textContent = signedIn
    ? isGuest
      ? "Guest mode active. Local session only in this browser."
      : "Hug account active. Claims and forum drafts use this local identity."
    : "Not signed in. Stored only in this browser.";
  action.textContent = signedIn
    ? "Open chat with this account"
    : "Sign in above, or continue as guest.";
  signOut.hidden = !signedIn;
  if (signedIn) {
    status.textContent = isGuest
      ? "Guest session active. You can browse and test flows, then switch to a Hug account anytime."
      : "Signed in to Hug local demo account. This is browser-only auth until OAuth backend is connected.";
  }
}

document.getElementById("systemLoginBtn").addEventListener("click", () => {
  const emailInput = document.getElementById("systemEmail");
  const passwordInput = document.getElementById("systemPassword");
  const status = document.getElementById("loginStatus");
  const email = String(emailInput.value || "").trim() || DEFAULT_MEMBER_EMAIL;
  const password = String(passwordInput.value || "").trim();

  if (!email.includes("@")) {
    status.textContent = "Use a valid email to log in to Hug.";
    emailInput.focus();
    return;
  }
  if (!password) {
    status.textContent = "Enter a password to continue.";
    passwordInput.focus();
    return;
  }

  const member = buildMemberUser(email);
  writeHugUser(member);
  renderProfile();
  if (window.hugEvent)
    hugEvent("system_login_clicked", {
      user: member.username,
      provider: "hug-local",
    });
  window.location.href = "/chat.html";
});

document.getElementById("guestLoginBtn").addEventListener("click", () => {
  writeHugUser(guestUser);
  renderProfile();
  if (window.hugEvent)
    hugEvent("guest_login_clicked", { user: guestUser.username });
  window.location.href = "/chat.html";
});

document.getElementById("demoProfile").addEventListener("click", () => {
  const user = readHugUser();
  if (user && user.signedIn) {
    window.location.href = "/chat.html";
  }
});

document.getElementById("demoSignOut").addEventListener("click", () => {
  clearHugUser();
  renderProfile();
  document.getElementById("loginStatus").textContent =
    "Signed out. Log in to Hug or continue as guest.";
  if (window.hugEvent) hugEvent("demo_login_signed_out", { user: "local" });
});

document.querySelectorAll(".provider-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const provider = btn.dataset.provider || "provider";
    const status = document.getElementById("loginStatus");
    const label = `${provider[0].toUpperCase()}${provider.slice(1)}`;
    status.textContent = ["openai", "anthropic"].includes(provider)
      ? `${label} is reserved as a future chat-history import path for AI failure-mode collection.`
      : `${label} login is reserved for the next OAuth setup.`;
    if (window.hugEvent)
      hugEvent("login_provider_preview_clicked", { provider });
  });
});

renderProfile();
