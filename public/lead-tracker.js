/**
 * Союз-Бокса · трекер заявок с форм сайта.
 * Что делает:
 *   1) при первом заходе с рекламы запоминает UTM-метки в cookie (first-touch, 90 дней);
 *   2) при отправке любой формы с телефоном шлёт {phone, utm_*} в наш дашборд;
 *   3) телефон становится ключом склейки с клиентом в Fitbase.
 *
 * Установка: одной строкой в <head> сайта:
 *   <script src="https://souz-boxa-analytic.vercel.app/lead-tracker.js" defer></script>
 *
 * Ручной вызов (если форма нестандартная):
 *   window.souzLead('+7 903 148-08-04');
 */
(function () {
  var ENDPOINT = "https://souz-boxa-analytic.vercel.app/api/lead";
  var COOKIE = "mkt_first";
  var UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];

  function setCookie(name, value, days) {
    var d = new Date();
    d.setTime(d.getTime() + days * 864e5);
    document.cookie = name + "=" + encodeURIComponent(value) + ";expires=" + d.toUTCString() + ";path=/;SameSite=Lax";
  }
  function getCookie(name) {
    var m = document.cookie.match("(^|;)\\s*" + name + "\\s*=\\s*([^;]+)");
    return m ? decodeURIComponent(m.pop()) : "";
  }

  // 1) Захват UTM в first-touch cookie (не перезаписываем, если уже есть источник).
  function captureUtm() {
    var params = new URLSearchParams(location.search);
    var utm = {};
    var has = false;
    UTM_KEYS.forEach(function (k) {
      var v = params.get(k);
      if (v) {
        utm[k] = v;
        has = true;
      }
    });
    if (has && !getCookie(COOKIE)) {
      utm._landing = location.pathname;
      utm._ts = Date.now();
      setCookie(COOKIE, JSON.stringify(utm), 90);
    }
  }
  captureUtm();

  function storedUtm() {
    try {
      return JSON.parse(getCookie(COOKIE) || "{}");
    } catch (e) {
      return {};
    }
  }

  // ClientID Метрики (опционально) — если на сайте есть счётчик window.MKT_METRIKA_ID.
  function metrikaClientId(cb) {
    try {
      var id = window.MKT_METRIKA_ID;
      if (id && typeof window.ym === "function") {
        window.ym(Number(id), "getClientID", cb);
        return;
      }
    } catch (e) {}
    cb(null);
  }

  // 2) Отправка заявки.
  window.souzLead = function (phone, extra) {
    if (!phone) return;
    var utm = storedUtm();
    metrikaClientId(function (cid) {
      var payload = {
        phone: String(phone),
        channel: "form",
        utm_source: utm.utm_source || null,
        utm_medium: utm.utm_medium || null,
        utm_campaign: utm.utm_campaign || null,
        ym_client_id: cid || null,
        page: location.href,
      };
      if (extra) for (var k in extra) payload[k] = extra[k];
      try {
        fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          keepalive: true,
        });
      } catch (e) {}
    });
  };

  // 3) Автоперехват форм: ищем телефон в отправляемой форме.
  function findPhone(form) {
    var inputs = form.querySelectorAll("input");
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      var hint = ((el.type || "") + " " + (el.name || "") + " " + (el.id || "") + " " + (el.getAttribute("autocomplete") || "")).toLowerCase();
      if (el.type === "tel" || /phone|tel|телефон|nomer|номер/.test(hint)) {
        if (el.value && el.value.replace(/\D/g, "").length >= 10) return el.value;
      }
    }
    return null;
  }

  document.addEventListener(
    "submit",
    function (e) {
      try {
        var phone = findPhone(e.target);
        if (phone) window.souzLead(phone);
      } catch (err) {}
    },
    true
  );
})();
