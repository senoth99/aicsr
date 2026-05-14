(function (global) {
  "use strict";

  var AUTH = "ai_agents_auth";
  /** Уникальный идентификатор пользователя для вебхуков (живёт в куке). */
  var USER_ID = "ai_agents_user_id";
  /** Старая кука с «логином» — сбрасываем при выходе и при новом входе. */
  var LEGACY_LOGIN = "ai_agents_login";
  var MAX_AGE_SEC = 60 * 60 * 24 * 30;

  function newUserId() {
    try {
      if (global.crypto && typeof global.crypto.randomUUID === "function") {
        return global.crypto.randomUUID();
      }
    } catch (e) {
      /* ignore */
    }
    return "u-" + String(Date.now()) + "-" + Math.random().toString(36).slice(2, 12);
  }

  function getCookie(name) {
    var esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var m = document.cookie.match(new RegExp("(?:^|; )" + esc + "=([^;]*)"));
    if (!m) return "";
    try {
      return decodeURIComponent(m[1].replace(/\+/g, " "));
    } catch (e) {
      return m[1];
    }
  }

  function setCookie(name, value, maxAgeSec) {
    var enc = encodeURIComponent(value);
    document.cookie =
      name +
      "=" +
      enc +
      "; Path=/; Max-Age=" +
      String(maxAgeSec) +
      "; SameSite=Lax";
  }

  function eraseCookie(name) {
    document.cookie = name + "=; Path=/; Max-Age=0";
  }

  /** Удаляет старую метку из localStorage (раньше сессия жила там). */
  function migrateLegacyAuth() {
    try {
      localStorage.removeItem("ai_agents_auth");
    } catch (e) {
      /* ignore */
    }
  }

  global.AIAgentsAuth = {
    isAuthed: function () {
      return getCookie(AUTH) === "1";
    },

    /** Сессия только по паролю: в куке флаг `ai_agents_auth=1`. */
    setSession: function () {
      migrateLegacyAuth();
      eraseCookie(LEGACY_LOGIN);
      setCookie(AUTH, "1", MAX_AGE_SEC);
      if (!getCookie(USER_ID)) {
        setCookie(USER_ID, newUserId(), MAX_AGE_SEC);
      }
    },

    /**
     * Идентификатор пользователя для API/вебхуков (один на браузер, в куке).
     * Создаётся при первом входе или при первом обращении после входа.
     */
    getUserId: function () {
      var id = getCookie(USER_ID);
      if (!id) {
        id = newUserId();
        setCookie(USER_ID, id, MAX_AGE_SEC);
      }
      return id;
    },

    clearSession: function () {
      eraseCookie(AUTH);
      eraseCookie(LEGACY_LOGIN);
      eraseCookie(USER_ID);
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
