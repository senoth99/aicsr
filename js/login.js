(function () {
  "use strict";

  var PASSWORD = "1234";

  if (window.AIAgentsAuth && AIAgentsAuth.isAuthed()) {
    window.location.replace("index.html");
    return;
  }

  var passInput = document.getElementById("login-password");
  var btn = document.getElementById("login-submit");
  var err = document.getElementById("login-error");

  function tryLogin() {
    var pass = passInput.value;
    if (pass !== PASSWORD) {
      err.hidden = false;
      return;
    }
    err.hidden = true;
    AIAgentsAuth.setSession();
    window.location.replace("index.html");
  }

  btn.addEventListener("click", tryLogin);
  passInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") tryLogin();
  });
})();
