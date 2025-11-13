/* ===== RP Social Post — super simple version ===== */
(function () {
  if (typeof window === 'undefined') return;
  if (window.RP_POST_EXT_LOADED) return;
  window.RP_POST_EXT_LOADED = true;

  var MODULE = 'rpPostExt';

  var DEFAULTS = {
    maxMessages: 12,
    feed: []
  };

  function cloneDefaults() {
    return JSON.parse(JSON.stringify(DEFAULTS));
  }

  function getCtx() {
    try {
      if (window.SillyTavern && typeof window.SillyTavern.getContext === 'function') {
        return window.SillyTavern.getContext();
      }
    } catch (e) {}
    return null;
  }

  function ensureSettings() {
    var ctx = getCtx();
    if (!ctx) return cloneDefaults();

    if (!ctx.extensionSettings) ctx.extensionSettings = {};
    var store = ctx.extensionSettings;

    if (!store[MODULE]) {
      store[MODULE] = cloneDefaults();
    } else {
      var st = store[MODULE];
      for (var k in DEFAULTS) {
        if (!st.hasOwnProperty(k)) {
          var v = DEFAULTS[k];
          st[k] = Array.isArray(v) ? v.slice() : v;
        }
      }
      if (!Array.isArray(st.feed)) st.feed = [];
    }
    return store[MODULE];
  }

  function saveSettings() {
    var ctx = getCtx();
    if (!ctx) return;
    var fn = ctx.saveSettingsDebounced || ctx.saveSettings || null;
    if (typeof fn === 'function') fn.call(ctx);
  }

  function toast(msg) {
    if (typeof document === 'undefined') return;
    var el = document.getElementById('rp-post-ext__toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'rp-post-ext__toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(function () {
      el.style.opacity = '0';
    }, 1400);
  }

  function safeText(x) {
    return x == null ? '' : String(x);
  }

  function truncate(str, n) {
    str = safeText(str).replace(/\s+/g, ' ').trim();
    if (str.length <= n) return str;
    return str.slice(0, n - 1) + '…';
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function formatTime(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) +
           ' · ' + pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1);
  }

  function getCharName() {
    var ctx = getCtx() || {};
    return ctx.characterName ||
           (ctx.characters && ctx.characterId != null && ctx.characters[ctx.characterId] && ctx.characters[ctx.characterId].name) ||
           ctx.name2 ||
           '{{char}}';
  }

  function getUserName() {
    var ctx = getCtx() || {};
    return ctx.name1 || ctx.userName || '{{user}}';
  }

  function randomOf(arr) {
    if (!arr || !arr.length) return '';
    var i = Math.floor(Math.random() * arr.length);
    return arr[i];
  }

  function collectRecentMessages() {
    var ctx = getCtx();
    var st = ensureSettings();
    var chat = ctx && ctx.chat;
    if (!chat || !chat.length) return [];

    var max = Math.max(4, Math.min(40, st.maxMessages || DEFAULTS.maxMessages));
    var out = [];
    for (var i = chat.length - 1; i >= 0 && out.length < max; i--) {
      var m = chat[i];
      if (!m || typeof m.mes !== 'string') continue;
      out.push({ isUser: !!m.is_user, text: m.mes });
    }
    return out.reverse();
  }

  function buildPostFromChat() {
    var messages = collectRecentMessages();
    var charName = getCharName();
    var userName = getUserName();

    if (!messages.length) {
      return {
        text: 'วันนี้ยังไม่มีโรลกับ ' + userName + ' เลย จะให้ฉันบ่นอะไรก่อนล่ะเนี่ย 😤',
        empty: true
      };
    }

    var lines = [];
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      var who = m.isUser ? userName : charName;
      var body = truncate(m.text.replace(/[\r\n]+/g, ' / '), 120);
      lines.push('• ' + who + ': ' + body);
    }
    var bullets = lines.join('\n');

    var intro = randomOf([
      'วันนี้โรลกับ ' + userName + ' อีกแล้วนะ...',
      'อืมม โรลเมื่อกี้กับ ' + userName + ' นี่มัน...',
      'อัพเดตชีวิตในห้องแชทกับ ' + userName + ' หน่อยละกัน',
      'บันทึกชาวบ้าน (จริง ๆ คือบ่น ' + userName + ')'
    ]);

    var mood = randomOf([
      'คือมันทั้งฮา ทั้งน่าหัวร้อนในเวลาเดียวกันอะ 555',
      'เริ่มสงสัยแล้วล่ะว่าใครกันแน่ที่เป็นตัวสร้างเรื่อง 🤨',
      'ถ้าใครผ่านมาเห็นก็ช่วยเป็นพยานให้ฉันทีนะ...',
      'แต่ก็สนุกดีแหละ ไม่ได้บ่นจริงจังหรอก (มั้ง)'
    ]);

    return {
      text: intro + '\n\n' + bullets + '\n\n' + mood,
      empty: false,
      charName: charName,
      userName: userName
    };
  }

  function pushPost(post) {
    var st = ensureSettings();
    st.feed.unshift({
      time: Date.now(),
      text: safeText(post.text),
      charName: post.charName || getCharName(),
      userName: post.userName || getUserName()
    });
    if (st.feed.length > 100) st.feed.length = 100;
    saveSettings();
  }

  function ensurePopup() {
    if (typeof document === 'undefined') return null;

    var backdrop = document.getElementById('rp-post-ext__backdrop');
    if (backdrop) return backdrop;

    backdrop = document.createElement('div');
    backdrop.id = 'rp-post-ext__backdrop';

    var popup = document.createElement('div');
    popup.id = 'rp-post-ext__popup';

    var header = document.createElement('div');
    header.id = 'rp-post-ext__popup-header';

    var titleWrap = document.createElement('div');
    var title = document.createElement('div');
    title.id = 'rp-post-ext__popup-title';
    title.textContent = 'โซเชียล RP ของ ' + getCharName();

    var subtitle = document.createElement('div');
    subtitle.id = 'rp-post-ext__popup-subtitle';
    subtitle.textContent = 'ฟีดปลอมสไตล์เฟส/ทวิต — ให้ ' + getCharName() + ' มาเมาท์โรลกับ ' + getUserName();

    titleWrap.appendChild(title);
    titleWrap.appendChild(subtitle);

    var btnClose = document.createElement('button');
    btnClose.id = 'rp-post-ext__popup-close';
    btnClose.type = 'button';
    btnClose.innerHTML = '&times;';

    header.appendChild(titleWrap);
    header.appendChild(btnClose);

    var body = document.createElement('div');
    body.id = 'rp-post-ext__popup-body';

    var toolbar = document.createElement('div');
    toolbar.id = 'rp-post-ext__toolbar';

    var tl = document.createElement('div');
    tl.id = 'rp-post-ext__toolbar-left';
    var ttl = document.createElement('div');
    ttl.textContent = 'ฟีดโพสต์ของตัวละครนี้';
    var txt = document.createElement('div');
    txt.id = 'rp-post-ext__toolbar-text';
    txt.textContent = 'กดปุ่มด้านขวาเพื่อให้ ' + getCharName() + ' เอาโรลล่าสุดมาโพสต์';
    tl.appendChild(ttl);
    tl.appendChild(txt);

    var tr = document.createElement('div');
    tr.id = 'rp-post-ext__toolbar-right';
    var btnNew = document.createElement('button');
    btnNew.className = 'rp-post-ext__btn-primary';
    btnNew.type = 'button';
    btnNew.textContent = 'โพสต์ใหม่จากโรลล่าสุด';
    tr.appendChild(btnNew);

    toolbar.appendChild(tl);
    toolbar.appendChild(tr);

    var feed = document.createElement('div');
    feed.id = 'rp-post-ext__feed';

    body.appendChild(toolbar);
    body.appendChild(feed);

    popup.appendChild(header);
    popup.appendChild(body);
    backdrop.appendChild(popup);
    document.body.appendChild(backdrop);

    function closePopup() {
      backdrop.classList.remove('rp-post-ext__open');
    }

    btnClose.addEventListener('click', closePopup);
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) closePopup();
    });

    btnNew.addEventListener('click', function () {
      var res = buildPostFromChat();
      if (!res || res.empty) {
        toast('ยังไม่มีบทโรลให้เอามาโพสต์เลย');
        return;
      }
      pushPost(res);
      renderFeed(feed);
      toast('โพสต์ใหม่ของ ' + getCharName() + ' ถูกเพิ่มลงฟีดแล้ว ✨');
    });

    backdrop._rpFeedRefs = {
      feed: feed,
      open: function () { 
        backdrop.classList.add('rp-post-ext__open');
        renderFeed(feed);
      },
      close: closePopup
    };
    return backdrop;
  }

  function renderFeed(feedEl) {
    var st = ensureSettings();
    if (!feedEl) return;
    
    feedEl.innerHTML = '';

    if (!st.feed || !st.feed.length) {
      var empty = document.createElement('div');
      empty.id = 'rp-post-ext__empty';
      empty.textContent = 'ยังไม่มีโพสต์เลย กด "โพสต์ใหม่จากโรลล่าสุด" เพื่อให้ ' + getCharName() + ' เริ่มเมาท์ก่อนสิ~';
      feedEl.appendChild(empty);
      return;
    }

    for (var i = 0; i < st.feed.length; i++) {
      var item = st.feed[i];

      var wrap = document.createElement('div');
      wrap.className = 'rp-post-ext__post';

      var av = document.createElement('div');
      av.className = 'rp-post-ext__avatar';
      var letter = safeText(item.charName || '{{char}}').trim().charAt(0) || '?';
      av.textContent = letter.toUpperCase();

      var main = document.createElement('div');
      main.className = 'rp-post-ext__post-main';

      var hd = document.createElement('div');
      hd.className = 'rp-post-ext__post-header';

      var nm = document.createElement('div');
      nm.className = 'rp-post-ext__post-name';
      nm.textContent = item.charName || '{{char}}';

      var handle = document.createElement('div');
      handle.className = 'rp-post-ext__post-handle';
      handle.textContent = '@' + safeText(item.charName || 'char').toLowerCase().replace(/\s+/g, '_');

      var tm = document.createElement('div');
      tm.className = 'rp-post-ext__post-time';
      tm.textContent = formatTime(item.time);

      hd.appendChild(nm);
      hd.appendChild(handle);
      hd.appendChild(tm);

      var bd = document.createElement('div');
      bd.className = 'rp-post-ext__post-body';
      bd.textContent = item.text;

      main.appendChild(hd);
      main.appendChild(bd);

      wrap.appendChild(av);
      wrap.appendChild(main);

      feedEl.appendChild(wrap);
    }
  }

  function openFeed() {
    var backdrop = ensurePopup();
    if (!backdrop || !backdrop._rpFeedRefs) return;
    backdrop._rpFeedRefs.open();
  }

  function addMainButton() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('rp-post-ext__container')) return;

    // หาตำแหน่งที่เหมาะสมใน SillyTavern
    var mount = document.querySelector('.chat-input-container') || 
                document.querySelector('.input-group') || 
                document.querySelector('.send-form') || 
                document.querySelector('#send_form') || 
                document.querySelector('.chat-controls') || 
                document.querySelector('.st-user-input') || 
                document.body;

    var box = document.createElement('div');
    box.id = 'rp-post-ext__container';

    var btn = document.createElement('button');
    btn.id = 'rp-post-ext__btn';
    btn.type = 'button';
    btn.title = 'เปิดฟีดโซเชียลปลอมของ ' + getCharName();

    var icon = document.createElement('span');
    icon.textContent = '📣';
    var text = document.createElement('span');
    text.textContent = 'โซเชียล RP';

    btn.appendChild(icon);
    btn.appendChild(text);
    box.appendChild(btn);

    btn.addEventListener('click', openFeed);

    // ถ้าไม่เจอ container ที่เหมาะสม ให้วางที่มุมล่างซ้าย
    if (mount === document.body) {
      box.style.position = 'fixed';
      box.style.bottom = '12px';
      box.style.left = '12px';
      box.style.zIndex = '9999';
    }
    
    mount.appendChild(box);
  }

  function waitForDOM() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        setTimeout(addMainButton, 1000);
      });
    } else {
      setTimeout(addMainButton, 1000);
    }
  }

  // เริ่มต้น extension
  waitForDOM();

  // สำหรับการทดสอบจาก console
  window.RpSocialPost = {
    buildPostFromChat: buildPostFromChat,
    openFeed: openFeed,
    addMainButton: addMainButton
  };
})();
