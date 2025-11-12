// index.js (module) — Social Post Generator (improved selectors + debug)
const DEBUG = true; // set false to silence verbose logs

function log(...args){ if(DEBUG) console.log('[SPG]', ...args); }
function $id(id){ return document.getElementById(id); }

const toneEl = $id('spg-tone');
const countEl = $id('spg-count');
const draftEl = $id('spg-draft');
const messagesEl = $id('spg-messages');
const copyBtn = $id('spg-copy');
const editBtn = $id('spg-edit');
const openTweetBtn = $id('spg-open-tweet');
const openFbBtn = $id('spg-open-fb');
const insertHashtags = $id('spg-insert-hashtags');
const keywordsEl = $id('spg-keywords');
const debugEl = $id('spg-debug');

let lastExtracted = [];
let observer = null;
let debounceTimer = null;

// a broad list of selectors used by various versions/themes of SillyTavern
const CHAT_SELECTOR_CANDIDATES = [
  '.chat-messages',
  '.messages',
  '.st-messages',
  '.chat-lines',
  '#chat',
  '.thread',           // generic
  '[data-testid="chat"]',
  '.container-messages'
];

// message node candidates used inside chat container
const MESSAGE_NODE_SELECTORS = [
  '.message', '.chat-line', '.bubble', '.st-message', '.line'
];

function showDebug(msg){
  if(debugEl) debugEl.textContent = msg;
  if(DEBUG) console.debug('[SPG-debug]', msg);
}

// find chat container by a set of common selectors, else fallback to scanning for area with many text nodes
function findChatContainer(){
  for(const s of CHAT_SELECTOR_CANDIDATES){
    const el = document.querySelector(s);
    if(el) { log('Found chat container by candidate', s); return el; }
  }
  // fallback: find element that contains many child text nodes and is visible
  const divs = Array.from(document.querySelectorAll('div')).filter(d=>d.offsetParent !== null);
  let best = null, bestScore = 0;
  for(const d of divs){
    const txt = (d.innerText||'').trim();
    if(txt.length < 200) continue;
    const lines = txt.split(/\n/).length;
    const score = lines;
    if(score > bestScore){
      bestScore = score; best = d;
    }
  }
  if(best) log('Fallback found container with score', bestScore);
  return best;
}

// extract messages: try to find message nodes inside container, else split by lines
function extractMessagesFromDom(){
  const container = findChatContainer();
  if(!container) {
    showDebug('ไม่พบ chat container — ตรวจสอบ selector ของธีม SillyTavern ของคุณ');
    return [];
  }
  showDebug('Chat container found');
  let nodes = [];
  for(const sel of MESSAGE_NODE_SELECTORS){
    const found = Array.from(container.querySelectorAll(sel));
    if(found.length) { nodes = found; break; }
  }
  // if none found, try direct children
  if(nodes.length === 0){
    nodes = Array.from(container.children).filter(c => (c.innerText||'').trim().length>0);
  }
  // map nodes -> {who, text}
  const out = [];
  for(const n of nodes){
    const text = (n.innerText||'').trim();
    if(!text) continue;
    // attempt to extract speaker name
    let who = 'Unknown';
    const whoEl = n.querySelector('.who, .speaker, .name, .from') || n.querySelector('b, strong');
    if(whoEl && whoEl.innerText) who = whoEl.innerText.trim().split('\n')[0];
    // remove speaker prefix if present in text
    let pureText = text;
    const possiblePrefix = new RegExp(`^${escapeForRegex(who)}[:\\-\\s]+`);
    try { pureText = pureText.replace(possiblePrefix, '').trim(); } catch(e){}
    out.push({ who, text: pureText });
  }

  // collapse adjacents from same who
  const collapsed = [];
  for(const m of out){
    if(!collapsed.length){ collapsed.push(m); continue; }
    const last = collapsed[collapsed.length-1];
    if(last.who === m.who){
      last.text = last.text + '\n' + m.text;
    } else collapsed.push(m);
  }
  return collapsed;
}

function escapeForRegex(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }

// build draft like before but slightly improved
function buildDraftFromMessages(msgs, tone, maxCount, keywords){
  if(!msgs || msgs.length===0) return '';
  const last = msgs.slice(-maxCount);
  const snippets = last.map(m => {
    const lines = m.text.split(/\n/).map(l=>l.trim()).filter(Boolean);
    let best = lines.find(l => /[!?]|[ก-ฮ]/) || lines[0] || '';
    // if best is long, truncate
    if(best.length>140) best = best.slice(0,137)+'...';
    // include who if present
    if(m.who && !/^Unknown$/i.test(m.who)) return `${m.who}: ${best}`;
    return best;
  });
  let base = snippets.join(' / ');
  if(base.length > 240) base = base.slice(0,237)+'...';

  function toTone(text,t){
    if(!text) return text;
    switch(t){
      case 'complain': return `อีกแล้ว... ${text} ทำไมมันต้องเป็นแบบนี้นะ`;
      case 'funny': return `${text} ฮา ๆ 😂 #ชีวิตโรล`;
      case 'sad': return `${text} ...ก็เป็นงี้แหละ`;
      case 'brag': return `ชนะอีกแล้ว 😎 ${text}`;
      default: return text;
    }
  }
  const toned = toTone(base, tone);
  let hashtags = '';
  if(insertHashtags && insertHashtags.checked && keywords){
    const kws = keywords.split(',').map(k=>k.trim()).filter(Boolean).slice(0,5).map(k=>'#'+k.replace(/\s+/g,''));
    if(kws.length) hashtags = ' ' + kws.join(' ');
  }
  return toned + hashtags;
}

function renderMessages(msgs){
  if(!messagesEl) return;
  messagesEl.innerHTML = '';
  msgs.slice(-30).reverse().forEach(m=>{
    const div = document.createElement('div'); div.className='msg';
    const who = document.createElement('div'); who.className='who'; who.textContent = (m.who||'Unknown').slice(0,40);
    const txt = document.createElement('div'); txt.className='text'; txt.textContent = m.text.length>300?m.text.slice(0,300)+'...':m.text;
    div.appendChild(who); div.appendChild(txt);
    messagesEl.appendChild(div);
  });
}

// update pipeline
function updatePipeline(){
  const msgs = extractMessagesFromDom();
  if(!msgs.length) {
    setDraft('');
    renderMessages([]);
    return;
  }
  // simple change detection
  const key = msgs.map(m=>m.who+':'+m.text.slice(0,80)).join('|');
  const lastKey = lastExtracted.map(m=>m.who+':'+m.text.slice(0,80)).join('|');
  if(key === lastKey) { log('No change in messages'); return; }
  lastExtracted = msgs;
  renderMessages(msgs);
  const tone = toneEl?.value || 'neutral';
  const maxCount = parseInt(countEl?.value||'4',10) || 4;
  const keywords = keywordsEl?.value || '';
  const draft = buildDraftFromMessages(msgs, tone, maxCount, keywords);
  setDraft(draft);
}

let userEditing = false;
function setDraft(text){
  if(!draftEl) return;
  if(userEditing) return;
  draftEl.value = text;
}

// attach mutation observer to the first valid chat container found
function attachObserver(){
  if(observer) observer.disconnect();
  const container = findChatContainer();
  if(!container){
    showDebug('ยังไม่พบ chat container — retrying in background');
    // retry periodically up to some times
    let tries = 0;
    const t = setInterval(()=>{
      tries++;
      const c = findChatContainer();
      if(c || tries>12){
        clearInterval(t);
        if(c) startObserving(c);
        else showDebug('ไม่พบ chat container หลังจากหลายครั้ง — โปรดเปิดแชทหรือส่ง screenshot ให้ผมดู');
      }
    }, 600);
    return;
  }
  startObserving(container);
}

function startObserving(container){
  showDebug('เริ่มสังเกต container');
  observer = new MutationObserver(muts=>{
    if(debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(()=> {
      try{ updatePipeline(); } catch(e){ console.error('[SPG] update error', e); showDebug('Update error: '+String(e)); }
    }, 400);
  });
  observer.observe(container, { childList:true, subtree:true, characterData:true });
  // initial run
  updatePipeline();
}

// UI actions
copyBtn.addEventListener('click', async ()=>{
  try{
    await navigator.clipboard.writeText(draftEl.value || '');
    copyBtn.textContent = 'คัดลอกแล้ว ✓';
    setTimeout(()=> copyBtn.textContent = 'คัดลอก', 1200);
  } catch(e){ alert('คัดลอกไม่สำเร็จ: '+String(e)); }
});

editBtn.addEventListener('click', ()=>{
  if(!userEditing){
    draftEl.removeAttribute('readonly'); draftEl.focus(); editBtn.textContent='บันทึก'; userEditing=true;
  } else {
    draftEl.setAttribute('readonly',''); editBtn.textContent='แก้ไข'; userEditing=false;
  }
});

openTweetBtn.addEventListener('click', ()=> {
  const text = draftEl.value || '';
  const url = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text);
  window.open(url,'_blank','noopener');
});

openFbBtn.addEventListener('click', ()=> {
  const text = draftEl.value || '';
  const dummyUrl = 'https://example.com/roleplay';
  const url = 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(dummyUrl) + '&quote=' + encodeURIComponent(text);
  window.open(url,'_blank','noopener');
});

[toneEl, countEl, keywordsEl, insertHashtags].forEach(el=>{
  if(!el) return;
  el.addEventListener('change', ()=> {
    if(debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(updatePipeline, 200);
  });
});

draftEl.addEventListener('input', ()=> { if(!draftEl.hasAttribute('readonly')) userEditing = true; });

// init when DOM for panel loaded
function init(){
  log('SPG init');
  showDebug('กำลังค้นหา chat container...');
  attachObserver();
  // expose debug helpers
  window.__SPG = { updatePipeline, extractMessagesFromDom, findChatContainer, DEBUG };
  log('SPG ready; window.__SPG available');
}

document.addEventListener('readystatechange', ()=>{
  if(document.readyState === 'complete' || document.readyState === 'interactive') init();
});  let debounceTimer = null;

  // try to find a likely chat container
  function findChatContainer() {
    for (const s of CHAT_SELECTOR_CANDIDATES) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    // fallback: find big container with many text children
    const all = Array.from(document.querySelectorAll('div'));
    let best = null, bestCount = 0;
    for (const el of all) {
      const txt = el.innerText || '';
      const count = (txt.match(/\n/g) || []).length;
      if (count > bestCount && txt.length > 200) { best = el; bestCount = count; }
    }
    return best;
  }

  // extract messages from DOM: returns array of {who, text}
  function extractMessagesFromDom() {
    if (!chatContainer) chatContainer = findChatContainer();
    if (!chatContainer) return [];

    // Heuristics: many themes have repeated message nodes. We'll traverse children and
    // collect short text blocks that look like messages.
    const nodes = Array.from(chatContainer.querySelectorAll('*'));
    const msgs = [];
    for (const n of nodes) {
      // skip containers
      const text = (n.innerText || '').trim();
      if (!text) continue;
      // heuristics: treat ones with linebreaks or limited length as a message
      if (text.length > 6 && text.length < 2000) {
        // attempt to identify speaker by preceding sibling or .who class
        let who = 'Unknown';
        const whoEl = n.querySelector('.who, .speaker, .name') || n.previousElementSibling && (n.previousElementSibling.querySelector && (n.previousElementSibling.querySelector('.who') || n.previousElementSibling));
        if (whoEl && whoEl.innerText) {
          who = whoEl.innerText.trim().split('\n')[0];
        } else {
          // attempt to parse prefix like "Player: text"
          const m = text.match(/^([A-Za-z0-9_ก-๙\- ]{1,40}):\s/);
          if (m) who = m[1];
        }
        msgs.push({ who, text });
      }
    }

    // cleanup: merge contiguous messages by same speaker and dedupe small ones
    const out = [];
    for (const m of msgs) {
      if (!out.length) { out.push(m); continue; }
      const last = out[out.length - 1];
      if (last.who === m.who && m.text.length < 220) {
        last.text = last.text + '\n' + m.text;
      } else {
        out.push(m);
      }
    }
    return out;
  }

  // build draft post from messages and tone
  function buildDraftFromMessages(msgs, tone, maxCount, keywords) {
    if (!msgs || msgs.length === 0) return '';

    // take last N messages
    const last = msgs.slice(-maxCount);

    // Compose a short summary by heuristics:
    // - take notable lines (lines containing exclamation/question or emotional words)
    // - fallback: take short snippets from each message
    const snippets = [];
    for (const m of last) {
      // split into lines, pick the 'most expressive' line
      const lines = m.text.split(/\n/).map(s=>s.trim()).filter(Boolean);
      let best = lines[0] || '';
      // prefer lines with punctuation or shortness
      for (const l of lines.slice(0,3)) {
        if (/[!?]/.test(l) || l.length < 80) { best = l; break; }
      }
      // prepend who if not system
      if (m.who && !/^\s*$/.test(m.who)) best = `${m.who}: ${best}`;
      snippets.push(best);
    }

    // tone transformation rules
    function toTone(text, t) {
      if (!text) return text;
      switch (t) {
        case 'complain':
          // add a complaining prefix and a sigh
          return `อีกแล้ว... ${text} ทำไมมันต้องเป็นแบบนี้นะ`;
        case 'funny':
          return `${text} ฮาา ๆ 😂 #ชีวิตโรล`;
        case 'sad':
          return `${text} ...ก็เป็นงี้แหละ`;
        case 'brag':
          return `ชนะอีกแล้ว 😎 ${text}`;
        case 'neutral':
        default:
          return text;
      }
    }

    // join snippets into short paragraph
    let base = snippets.join(' / ');
    // limit length to ~240 (for twitter)
    if (base.length > 220) base = base.slice(0, 217) + '...';

    // apply tone
    const toned = toTone(base, tone);

    // hashtags
    let hashtags = '';
    if (insertHashtags.checked && keywords && keywords.length) {
      const kws = keywords.split(',').map(k=>k.trim()).filter(Boolean).slice(0,5)
                    .map(k=> '#'+k.replace(/\s+/g,''));
      if (kws.length) hashtags = ' ' + kws.join(' ');
    }

    return toned + hashtags;
  }

  // render messages list in UI
  function renderMessages(msgs) {
    messagesEl.innerHTML = '';
    msgs.slice(-30).reverse().forEach(m=>{
      const div = document.createElement('div');
      div.className = 'msg';
      const whoDiv = document.createElement('div');
      whoDiv.className = 'who';
      whoDiv.textContent = (m.who || 'Unknown').slice(0,40);
      const textDiv = document.createElement('div');
      textDiv.className = 'text';
      textDiv.textContent = m.text.length>300 ? m.text.slice(0,300)+'...' : m.text;
      div.appendChild(whoDiv);
      div.appendChild(textDiv);
      messagesEl.appendChild(div);
    });
  }

  // set draft text to textarea (or keep user edits if they toggled)
  let userEditing = false;
  function setDraft(text) {
    if (userEditing) return;
    draftEl.value = text;
  }

  // core: update pipeline (extract -> build -> render)
  function updatePipeline() {
    const msgs = extractMessagesFromDom();
    // simple dedupe: if identical to lastExtracted, skip
    const key = msgs.map(m=>m.who+':'+m.text.slice(0,80)).join('|');
    const lastKey = lastExtracted.map(m=>m.who+':'+m.text.slice(0,80)).join('|');
    if (key === lastKey) {
      // nothing changed
      return;
    }
    lastExtracted = msgs;
    renderMessages(msgs);
    const tone = toneEl.value;
    const maxCount = parseInt(countEl.value,10) || 4;
    const keywords = keywordsEl.value || '';
    const draft = buildDraftFromMessages(msgs, tone, maxCount, keywords);
    setDraft(draft);
  }

  // attach observer to chat container
  function attachObserver() {
    if (observer) observer.disconnect();
    if (!chatContainer) chatContainer = findChatContainer();
    if (!chatContainer) {
      console.warn('[SPG] chat container not found — will retry later');
      return;
    }
    observer = new MutationObserver(muts=>{
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(()=> {
        try{ updatePipeline(); } catch(e){ console.error('[SPG] update error', e); }
      }, 600);
    });
    observer.observe(chatContainer, { childList: true, subtree:true, characterData:true });
    // initial update
    updatePipeline();
  }

  // UI event handlers
  copyBtn.addEventListener('click', ()=>{
    const text = draftEl.value;
    if (!text) return;
    navigator.clipboard.writeText(text).then(()=>{
      copyBtn.textContent = 'คัดลอกแล้ว ✓';
      setTimeout(()=> copyBtn.textContent = 'คัดลอก', 1200);
    }).catch(err=>{
      alert('คัดลอกไม่สำเร็จ — เบราว์เซอร์อาจบล็อกการคัดลอก: '+err);
    });
  });

  editBtn.addEventListener('click', ()=>{
    if (!userEditing) {
      draftEl.removeAttribute('readonly');
      draftEl.focus();
      editBtn.textContent = 'บันทึก';
      userEditing = true;
    } else {
      // save edits: make them final until next auto-update
      draftEl.setAttribute('readonly','');
      editBtn.textContent = 'แก้ไข';
      userEditing = false;
    }
  });

  openTweetBtn.addEventListener('click', ()=>{
    const text = draftEl.value || '';
    // tweet intent: https://twitter.com/intent/tweet?text=...
    const url = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text);
    window.open(url, '_blank', 'noopener');
  });

  openFbBtn.addEventListener('click', ()=>{
    const text = draftEl.value || '';
    // Facebook share dialog can prefill quote param:
    // https://www.facebook.com/sharer/sharer.php?u=<url>&quote=<text>
    // Since we don't have a URL, we can share a dummy url with the quote
    const dummyUrl = 'https://example.com/roleplay'; // user can edit
    const url = 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(dummyUrl) + '&quote=' + encodeURIComponent(text);
    window.open(url, '_blank', 'noopener');
  });

  // detect when user edits keywords/tone/count -> rebuild
  [toneEl, countEl, keywordsEl, insertHashtags].forEach(el=>{
    el.addEventListener('change', ()=> {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(updatePipeline, 250);
    });
  });

  // if user types into draft while editing, keep userEditing true
  draftEl.addEventListener('input', ()=> { if (draftEl.hasAttribute('readonly')) return; userEditing = true; });

  // initialize on DOM ready (panel load)
  function initWhenReady(){
    // try find container now
    chatContainer = findChatContainer();
    if (!chatContainer) {
      // retry a few times in the background
      let tries = 0;
      const t = setInterval(()=>{
        tries++;
        chatContainer = findChatContainer();
        if (chatContainer || tries > 10) {
          clearInterval(t);
          attachObserver();
        }
      }, 800);
    } else {
      attachObserver();
    }
  }

  // small notification in console for debugging
  console.info('[SPG] Social Post Generator loaded');

  // start
  initWhenReady();

  // expose minimal debug API on window (dev only)
  window.__SPG = {
    updatePipeline,
    extractMessagesFromDom,
    findChatContainer
  };
})();
