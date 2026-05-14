(function () {
  "use strict";

  if (!window.AIAgentsAuth || !AIAgentsAuth.isAuthed()) {
    window.location.replace("login.html");
    return;
  }

  const STORAGE_KEYS = {
    agents: "ai_agents_config",
    messages: "ai_agents_messages",
  };

  /** Прямой URL вебхука (fallback): js/config.defaults.js и при необходимости /api/client-config.js. */
  const WEBHOOK =
    (typeof window !== "undefined" &&
      window.__AI_AGENTS__ &&
      typeof window.__AI_AGENTS__.directWebhook === "string" &&
      window.__AI_AGENTS__.directWebhook.trim()) ||
    "https://senoth.cashercollection.com/webhook/bddcd127-c647-4823-9ad9-8a9dd4688621";

  /** Если тот же origin отдаёт /api/health (Node server), чат шлёт POST на /api/webhook (CORS не нужен). */
  let localProxyResolved = null;

  async function resolveChatPostUrl() {
    if (typeof location === "undefined") return WEBHOOK;
    if (!location.origin || location.protocol === "file:") return WEBHOOK;
    if (localProxyResolved === false) return WEBHOOK;
    if (typeof localProxyResolved === "string") return localProxyResolved;
    const healthUrl = new URL("/api/health", location.origin).href;
    const ac = new AbortController();
    const tid = setTimeout(function () {
      ac.abort();
    }, 700);
    try {
      const r = await fetch(healthUrl, { signal: ac.signal, cache: "no-store" });
      clearTimeout(tid);
      if (!r.ok) throw new Error("no health");
      const d = await r.json();
      if (d && d.proxy) {
        localProxyResolved = new URL("/api/webhook", location.origin).href;
        return localProxyResolved;
      }
    } catch (_) {
      clearTimeout(tid);
    }
    localProxyResolved = false;
    return WEBHOOK;
  }

  const DEFAULT_AGENTS = [
    { id: "base", name: "База", webhook: "" },
    { id: "sales", name: "Продажи", webhook: "" },
    { id: "marketing", name: "Маркетинг", webhook: "" },
    { id: "production", name: "Производство", webhook: "" },
  ];

  /** @type {{ id: string, name: string, webhook: string }[]} */
  let agents = loadAgents();
  /** @type {string} */
  let activeAgentId = agents[0]?.id ?? "base";
  /** @type {Record<string, { role: string, content: string, ts: number }[]>} */
  let messagesByAgent = loadMessages();

  function loadAgents() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.agents);
      if (!raw) return JSON.parse(JSON.stringify(DEFAULT_AGENTS));
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) return JSON.parse(JSON.stringify(DEFAULT_AGENTS));
      return parsed.map((a, i) => ({
        id: String(a.id || DEFAULT_AGENTS[i]?.id || `agent-${i}`),
        name: String(a.name || `Агент ${i + 1}`),
        webhook: typeof a.webhook === "string" ? a.webhook : "",
      }));
    } catch {
      return JSON.parse(JSON.stringify(DEFAULT_AGENTS));
    }
  }

  function saveAgents() {
    localStorage.setItem(STORAGE_KEYS.agents, JSON.stringify(agents));
  }

  function loadMessages() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.messages);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveMessages() {
    localStorage.setItem(STORAGE_KEYS.messages, JSON.stringify(messagesByAgent));
  }

  function getMessages(agentId) {
    if (!messagesByAgent[agentId]) messagesByAgent[agentId] = [];
    return messagesByAgent[agentId];
  }

  function escapeHtmlPlain(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** Markdown или HTML из вебхука → безопасный HTML для пузыря чата. */
  function chatMessageToSafeHtml(content) {
    const str = String(content ?? "");
    if (/^\s*<!DOCTYPE/i.test(str) || /^\s*<html[\s>]/i.test(str)) {
      return (
        "<pre class=\"msg-pre msg-pre--raw\">" +
        escapeHtmlPlain(str) +
        "</pre>"
      );
    }
    if (typeof DOMPurify !== "undefined") {
      let html = str;
      if (typeof marked !== "undefined" && typeof marked.parse === "function") {
        html = marked.parse(str, { breaks: true, gfm: true });
      } else {
        html = escapeHtmlPlain(str).replace(/\n/g, "<br>");
      }
      return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    }
    return escapeHtmlPlain(str).replace(/\n/g, "<br>");
  }

  /** Ключ модели для вебхука: baza | sales | mark | proiz */
  function modelKeyForAgent(agentId) {
    switch (agentId) {
      case "base":
        return "baza";
      case "sales":
        return "sales";
      case "marketing":
        return "mark";
      case "production":
        return "proiz";
      default:
        return String(agentId || "unknown");
    }
  }

  function outputToText(v) {
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (typeof v === "object") return JSON.stringify(v, null, 2);
    return String(v);
  }

  function replyTextFromPayload(data) {
    if (data == null) return "";
    if (typeof data === "string") return data;
    if (typeof data === "number" || typeof data === "boolean") return String(data);
    if (Array.isArray(data)) {
      if (data.length === 0) return "";
      return replyTextFromPayload(data[0]);
    }
    if (typeof data !== "object") return String(data);
    if (Object.prototype.hasOwnProperty.call(data, "output")) {
      return data.output == null ? "" : outputToText(data.output);
    }
    const t =
      typeof data.reply === "string"
        ? data.reply
        : typeof data.text === "string"
          ? data.text
          : typeof data.message === "string"
            ? data.message
            : typeof data.content === "string"
              ? data.content
              : "";
    return t || JSON.stringify(data, null, 2);
  }

  /**
   * Сервер часто шлёт Content-Type: application/json с пустым телом — res.json() тогда падает.
   * Читаем text(), при непустом JSON парсим вручную.
   */
  function replyTextFromResponse(raw, contentType) {
    const trimmed = (raw || "").trim();
    if (!trimmed) return "";
    const ct = contentType || "";
    const looksJson =
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"));
    if (ct.includes("application/json") || looksJson) {
      try {
        const data = JSON.parse(trimmed);
        return replyTextFromPayload(data);
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }

  /**
   * Металлические аватары агентов (острые углы, изумрудная палитра).
   * @param {string} agentId
   * @param {number} [size=44]
   * @param {string} [scope] уникальный префикс id внутри SVG (несколько сообщений в DOM)
   */
  function agentAvatarSvg(agentId, size, scope) {
    const w = size == null ? 44 : size;
    const sc = scope || `r${Math.random().toString(36).slice(2, 10)}`;
    const wrap = (inner) =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44" width="${w}" height="${w}" aria-hidden="true">${inner}</svg>`;

    switch (agentId) {
      case "base":
        return wrap(`
  <defs>
    <linearGradient id="${sc}-avb-bg" x1="0" y1="0" x2="44" y2="44"><stop offset="0%" stop-color="#0a1c10"/><stop offset="100%" stop-color="#010302"/></linearGradient>
    <linearGradient id="${sc}-avb-s1" x1="22" y1="8" x2="22" y2="40"><stop offset="0%" stop-color="#8ef0a8"/><stop offset="35%" stop-color="#3a9e52"/><stop offset="100%" stop-color="#0d2814"/></linearGradient>
    <linearGradient id="${sc}-avb-s2" x1="0" y1="0" x2="40" y2="0"><stop offset="0%" stop-color="#1f5a32"/><stop offset="50%" stop-color="#5fd87a"/><stop offset="100%" stop-color="#1a4a28"/></linearGradient>
  </defs>
  <rect width="44" height="44" fill="url(#${sc}-avb-bg)"/>
  <path fill="url(#${sc}-avb-s2)" opacity="0.9" d="M4 32 L22 22 L40 32 L40 36 L22 26 L4 36 Z"/>
  <path fill="url(#${sc}-avb-s1)" d="M8 26 L22 17 L36 26 L36 30 L22 21 L8 30 Z"/>
  <path fill="#143d22" stroke="#6bdc88" stroke-width="0.65" d="M12 20 L22 14 L32 20 L32 23 L22 17 L12 23 Z"/>
  <path stroke="#4a9c62" stroke-width="0.45" opacity="0.75" d="M10 28h24M13 24h18"/>
  <rect x="20" y="9" width="4" height="3" fill="#b8f5c4"/>
`.trim());

      case "sales":
        return wrap(`
  <defs>
    <linearGradient id="${sc}-avs-bg" x1="22" y1="0" x2="22" y2="44"><stop offset="0%" stop-color="#061208"/><stop offset="100%" stop-color="#020403"/></linearGradient>
    <linearGradient id="${sc}-avs-bar" x1="0" y1="44" x2="0" y2="0"><stop offset="0%" stop-color="#124022"/><stop offset="55%" stop-color="#2f8f48"/><stop offset="100%" stop-color="#9ef0b0"/></linearGradient>
  </defs>
  <rect width="44" height="44" fill="url(#${sc}-avs-bg)"/>
  <rect x="5" y="28" width="6" height="11" fill="url(#${sc}-avs-bar)" opacity="0.85"/>
  <rect x="14" y="22" width="6" height="17" fill="url(#${sc}-avs-bar)"/>
  <rect x="23" y="14" width="6" height="25" fill="url(#${sc}-avs-bar)" opacity="0.95"/>
  <rect x="32" y="18" width="6" height="21" fill="url(#${sc}-avs-bar)" opacity="0.8"/>
  <path d="M6 12 L14 8 L22 11 L30 6 L38 10" fill="none" stroke="#5ecf6e" stroke-width="1.1" stroke-linecap="square" opacity="0.85"/>
  <circle cx="38" cy="10" r="2.2" fill="#c8ffd4" stroke="#3e8e41" stroke-width="0.5"/>
`.trim());

      case "marketing":
        return wrap(`
  <defs>
    <linearGradient id="${sc}-avm-bg" x1="0" y1="44" x2="44" y2="0"><stop offset="0%" stop-color="#020805"/><stop offset="100%" stop-color="#0c2416"/></linearGradient>
    <linearGradient id="${sc}-avm-ray" x1="0" y1="44" x2="44" y2="0"><stop offset="0%" stop-color="#1a4d2e"/><stop offset="100%" stop-color="#7ef098"/></linearGradient>
  </defs>
  <rect width="44" height="44" fill="url(#${sc}-avm-bg)"/>
  <path d="M2 42 Q22 22 42 2" fill="none" stroke="url(#${sc}-avm-ray)" stroke-width="1.5" opacity="0.35"/>
  <path d="M6 42 Q22 26 38 10" fill="none" stroke="#4ecf6a" stroke-width="1.2" opacity="0.55"/>
  <path d="M10 42 Q22 30 34 18" fill="none" stroke="#8ef5a4" stroke-width="1" opacity="0.9"/>
  <polygon points="22,6 26,14 18,14" fill="#3e8e41" stroke="#a3d9a5" stroke-width="0.6"/>
  <rect x="19" y="14" width="6" height="10" fill="#285e3e" stroke="#6bdc88" stroke-width="0.5"/>
  <path d="M14 38 L22 32 L30 38" fill="none" stroke="#5aa06e" stroke-width="0.8" opacity="0.7"/>
`.trim());

      case "production":
        return wrap(`
  <defs>
    <linearGradient id="${sc}-avp-bg" x1="0" y1="22" x2="44" y2="22"><stop offset="0%" stop-color="#030a06"/><stop offset="50%" stop-color="#0f2818"/><stop offset="100%" stop-color="#030a06"/></linearGradient>
    <linearGradient id="${sc}-avp-gear" x1="22" y1="8" x2="22" y2="36"><stop offset="0%" stop-color="#a3e9b0"/><stop offset="40%" stop-color="#3d9e52"/><stop offset="100%" stop-color="#12381f"/></linearGradient>
  </defs>
  <rect width="44" height="44" fill="url(#${sc}-avp-bg)"/>
  <path fill="none" stroke="#4ecf6a" stroke-width="0.9" d="M22 4 L26 8 L32 7 L33 13 L38 16 L35 21 L38 26 L33 29 L32 35 L26 34 L22 38 L18 34 L12 35 L11 29 L6 26 L9 21 L6 16 L11 13 L12 7 L18 8 Z"/>
  <circle cx="22" cy="21" r="11" fill="none" stroke="url(#${sc}-avp-gear)" stroke-width="2.4"/>
  <circle cx="22" cy="21" r="5" fill="#0a1f12" stroke="#6bdc88" stroke-width="0.7"/>
  <rect x="21" y="10" width="2" height="4" fill="#8ef0a8"/><rect x="21" y="28" width="2" height="4" fill="#8ef0a8"/>
  <rect x="10" y="20" width="4" height="2" fill="#8ef0a8"/><rect x="28" y="20" width="4" height="2" fill="#8ef0a8"/>
`.trim());

      default: {
        const h = Math.abs(agentId.split("").reduce((a, c) => a + c.charCodeAt(0), 0)) % 40;
        return wrap(`
  <defs>
    <linearGradient id="${sc}-avd-bg" x1="0" y1="0" x2="44" y2="44"><stop offset="0%" stop-color="#050806"/><stop offset="100%" stop-color="#0a1a10"/></linearGradient>
    <linearGradient id="${sc}-avd-g" x1="0" y1="22" x2="44" y2="22">
      <stop offset="0%" stop-color="hsl(${140 + h}, 55%, 22%)"/><stop offset="50%" stop-color="hsl(${150 + h}, 50%, 48%)"/><stop offset="100%" stop-color="hsl(${130 + h}, 45%, 18%)"/>
    </linearGradient>
  </defs>
  <rect width="44" height="44" fill="url(#${sc}-avd-bg)"/>
  <path d="M22 3 L40 14 L40 30 L22 41 L4 30 L4 14 Z" fill="url(#${sc}-avd-g)" opacity="0.92" stroke="#5ecf6e" stroke-width="0.6"/>
  <path d="M22 10 L33 17 L33 27 L22 34 L11 27 L11 17 Z" fill="#061208" opacity="0.55" stroke="#7fd99b" stroke-width="0.5"/>
`.trim());
      }
    }
  }

  const el = {
    agentTabs: document.getElementById("agent-tabs"),
    chatMessages: document.getElementById("chat-messages"),
    chatInput: document.getElementById("chat-input"),
    chatSend: document.getElementById("chat-send"),
    chatAgentName: document.getElementById("chat-agent-name"),
  };

  let sendLocked = false;

  function setSendLocked(locked) {
    sendLocked = !!locked;
    el.chatSend.disabled = sendLocked;
  }

  function initApp() {
    renderAgentTabs();
    renderChat();
    el.chatInput.focus();
  }

  function renderAgentTabs() {
    el.agentTabs.innerHTML = "";
    agents.forEach((a) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "agent-tab" + (a.id === activeAgentId ? " is-active" : "");
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", a.id === activeAgentId ? "true" : "false");
      b.dataset.agentId = a.id;
      const icon = document.createElement("span");
      icon.className = "agent-tab-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = agentAvatarSvg(a.id, 22, `t-${a.id}`);
      const lab = document.createElement("span");
      lab.className = "agent-tab-label";
      lab.textContent = a.name;
      b.appendChild(icon);
      b.appendChild(lab);
      b.addEventListener("click", () => {
        activeAgentId = a.id;
        renderAgentTabs();
        renderChat();
      });
      el.agentTabs.appendChild(b);
    });
  }

  function formatShortTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }

  function renderChat() {
    const agent = agents.find((x) => x.id === activeAgentId);
    el.chatAgentName.textContent = agent ? `— ${agent.name}` : "";
    const list = getMessages(activeAgentId);
    el.chatMessages.innerHTML = "";
    if (list.length === 0) {
      return;
    }
    list.forEach((m, msgIdx) => {
      const isUser = m.role === "user";
      const row = document.createElement("div");
      row.className = "msg" + (isUser ? " msg--out" : " msg--in");
      const body = document.createElement("div");
      body.className = "msg-body";
      const inner = document.createElement("div");
      inner.className = "tg-bubble-inner";
      const text = document.createElement("div");
      text.className = "msg-text msg-text--rich";
      text.innerHTML = chatMessageToSafeHtml(m.content);
      const meta = document.createElement("span");
      meta.className = "msg-meta tg-bubble-time";
      meta.textContent = formatShortTime(m.ts);
      inner.appendChild(text);
      inner.appendChild(meta);
      body.appendChild(inner);
      if (!isUser) {
        const av = document.createElement("div");
        av.className = "avatar";
        const aid = agent?.id ?? "bot";
        av.innerHTML = agentAvatarSvg(aid, 42, `c${msgIdx}-${m.ts}`);
        row.appendChild(av);
      }
      row.appendChild(body);
      el.chatMessages.appendChild(row);
    });
    el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  }

  async function sendChat() {
    const text = el.chatInput.value.trim();
    if (!text) return;
    if (sendLocked) return;
    const agent = agents.find((x) => x.id === activeAgentId);
    if (!agent) return;

    const list = getMessages(activeAgentId);
    const ts = Date.now();
    list.push({ role: "user", content: text, ts });
    el.chatInput.value = "";
    saveMessages();
    renderChat();
    setSendLocked(true);

    try {
      let replyText = "";
      const userId = AIAgentsAuth.getUserId();
      const model = modelKeyForAgent(agent.id);
      const postUrl = await resolveChatPostUrl();
      const res = await fetch(postUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          model,
          message: text,
        }),
      });
      const raw = await res.text();
      const ct = res.headers.get("content-type") || "";
      if ((res.status === 501 || res.status === 405) && /POST|Unsupported method|NOT_IMPLEMENTED/i.test(raw)) {
        replyText =
          "Локальный сервер не принимает POST (часто python http.server). Останови его и запусти в папке проекта: node server.mjs — затем обнови страницу.";
      } else if (!res.ok && (/text\/html/i.test(ct) || /^\s*<!doctype/i.test(raw))) {
        replyText =
          "[" +
          res.status +
          "] Сервер вернул HTML, а не JSON. На localhost нужен node server.mjs (прокси /api/webhook), не python -m http.server.";
      } else {
        replyText = replyTextFromResponse(raw, ct);
        if (!res.ok) {
          replyText = "[" + res.status + "] " + (replyText || res.statusText).trim();
        }
      }
      list.push({ role: "assistant", content: replyText || "(пустой ответ)", ts: Date.now() });
    } catch (e) {
      let msg = e instanceof Error ? e.message : String(e);
      if (
        typeof location !== "undefined" &&
        (location.hostname === "localhost" || location.hostname === "127.0.0.1") &&
        /fetch|network|failed|cors/i.test(msg)
      ) {
        msg +=
          " — с localhost браузер часто режет запросы к другому домену. Запусти в папке проекта: npm start (или node server.mjs), открой тот же порт.";
      }
      list.push({
        role: "assistant",
        content: "Ошибка сети: " + msg,
        ts: Date.now(),
      });
    } finally {
      saveMessages();
      renderChat();
      setSendLocked(false);
      el.chatInput.focus();
    }
  }

  el.chatSend.addEventListener("click", sendChat);
  el.chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (sendLocked) return;
      sendChat();
    }
  });

  initApp();
})();
