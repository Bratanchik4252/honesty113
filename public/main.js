'use strict';

const API_BASE = '/api';
const CLIENT_ID = 'oivt3xslzr0wi1b3eu4a59lntv5isk';
const REDIRECT_URI = window.location.origin;
const DRAFT_KEY = 'honesty113_draft_post';
const FEED_FILTER_KEY = 'honesty113_feed_filters';
/** Коммент-стикеры: эмодзи + короткое имя для подсказок */
const STICKERS = [
  { e: '🔥', name: 'Жара' },
  { e: '💀', name: 'Кринж' },
  { e: '😂', name: 'Ржака' },
  { e: '👍', name: 'Респект' },
  { e: '❤️', name: 'Сердечко' },
  { e: '🎉', name: 'Праздник' },
  { e: '🤝', name: 'Уважуха' },
  { e: '💡', name: 'Идея' },
];

const I18N = {
  ru: {
    nav_feed: 'Лента', nav_videos: 'Видосы', nav_discover: 'Обзор', nav_calendar: 'Календарь', nav_links: 'Ссылки',
    nav_settings: 'Настройки', nav_profile: 'Профиль', nav_admin: 'Модерация', login: 'Войти', out: 'Выйти',
  },
  en: {
    nav_feed: 'Feed', nav_videos: 'Videos', nav_discover: 'Discover', nav_calendar: 'Calendar', nav_links: 'Links',
    nav_settings: 'Settings', nav_profile: 'Profile', nav_admin: 'Mod', login: 'Log in', out: 'Log out',
  },
};

function T(k) {
  const lang = settings.language === 'en' ? 'en' : 'ru';
  return I18N[lang][k] || I18N.ru[k] || k;
}

function refreshI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const k = el.dataset.i18n;
    if (k) el.textContent = T(k);
  });
  document.documentElement.lang = settings.language === 'en' ? 'en' : 'ru';
}

let currentUser = null;
let allPosts = [];
let allComments = {};
let userVotes = JSON.parse(localStorage.getItem('userVotes') || '{}');
const defaultSettings = {
  theme: 'dark', fontSize: 'medium', fontFamily: 'system', animations: true, defaultSort: 'date_desc', language: 'ru',
  allowNsfwStream: false, hideCommentSpoilers: true, notifyLikes: false, notifyComments: false,
};
let settings = { ...defaultSettings, ...JSON.parse(localStorage.getItem('userSettings') || '{}') };
let pendingMediaDataUrl = '';
let feedFilters = JSON.parse(
  sessionStorage.getItem(FEED_FILTER_KEY) || '{"type":"all","time":"all","sort":"new","author":"","category":"all"}'
);
let replyTarget = null;
let editingPostId = null;
let feedDisplayCount = 15;
const PAGE_SIZE = 15;

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
}

function safeMediaUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const u = url.trim();
  if (u.startsWith('data:image/jpeg') || u.startsWith('data:image/png') || u.startsWith('data:image/webp')) return u;
  if (u.startsWith('https://') || u.startsWith('http://')) return u;
  return '';
}

function safeExternalUrl(url) {
  if (!url || typeof url !== 'string') return '#';
  const u = url.trim();
  if (u.startsWith('https://') || u.startsWith('http://')) return u.replace(/"/g, '&quot;');
  return '#';
}

function linkHostname(url) {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function postTimeMs(p) {
  const n = Number(p.id);
  return Number.isFinite(n) ? n : 0;
}

function formatCommentHtml(raw) {
  let t = escapeHtml(raw || '');
  t = t.replace(/@([a-zA-Z0-9_]{2,25})/g, '<span class="mention">@$1</span>');
  const sp = /\[спойлер\]([\s\S]*?)\[\/спойлер\]/gi;
  t = t.replace(sp, (_, inner) => {
    const id = 'sp-' + Math.random().toString(36).slice(2);
    const safeInner = escapeHtml(inner);
    return `<span class="spoiler-wrap"><button type="button" class="spoiler-btn" onclick="this.parentElement.classList.add('revealed')">Спойлер</button><span class="spoiler-body" id="${id}">${safeInner}</span></span>`;
  });
  return t;
}

function saveFeedFilters() {
  sessionStorage.setItem(FEED_FILTER_KEY, JSON.stringify(feedFilters));
}

function getRoute() {
  const u = new URLSearchParams(window.location.search);
  return { page: u.get('page') || 'feed', thread: u.get('thread') || '' };
}

function setRoute(page, thread) {
  const p = new URLSearchParams();
  if (page && page !== 'feed') p.set('page', page);
  if (thread) p.set('thread', thread);
  const s = p.toString();
  history.pushState({}, '', s ? `?${s}` : window.location.pathname);
  route();
}

function stopAdminPoll() {
  if (window.__adminPoll) {
    clearInterval(window.__adminPoll);
    window.__adminPoll = null;
  }
}

function route() {
  hideLoader();
  stopAdminPoll();
  const { page, thread } = getRoute();
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.page === page));
  if (thread) {
    renderThread(thread);
    return;
  }
  if (page === 'feed') renderFeedPage();
  else if (page === 'videos') renderVideosPage();
  else if (page === 'discover') renderDiscoverPage();
  else if (page === 'calendar') renderCalendar();
  else if (page === 'links') renderLinks();
  else if (page === 'settings') renderSettings();
  else if (page === 'profile') renderProfile();
  else if (page === 'admin') renderAdmin();
  else renderFeedPage();
}

function showLoader() {
  const el = document.getElementById('appLoader');
  if (el) el.classList.add('visible');
}
function hideLoader() {
  const el = document.getElementById('appLoader');
  if (el) el.classList.remove('visible');
}

function applySettings() {
  document.body.className = settings.theme;
  document.body.style.fontSize = settings.fontSize === 'large' ? '18px' : settings.fontSize === 'small' ? '14px' : '16px';
  const fonts = {
    system: "'Segoe UI', system-ui, -apple-system, sans-serif",
    inter: "'Inter', 'Segoe UI', system-ui, sans-serif",
    mono: "'JetBrains Mono', Consolas, 'Courier New', monospace",
    serif: "Georgia, 'Times New Roman', serif",
  };
  document.body.style.fontFamily = fonts[settings.fontFamily] || fonts.system;
  if (!settings.animations) document.documentElement.classList.add('no-anim');
  else document.documentElement.classList.remove('no-anim');
  refreshI18n();
}

function saveSettings() {
  localStorage.setItem('userSettings', JSON.stringify(settings));
  applySettings();
}

function loadUserFromStorage() {
  const saved = localStorage.getItem('twitchUser');
  if (saved) {
    currentUser = JSON.parse(saved);
    updateUserWidget();
  }
}

function checkTwitchAuth() {
  const hash = window.location.hash.substring(1);
  const params = new URLSearchParams(hash);
  const token = params.get('access_token');
  if (!token) return;
  fetch('https://api.twitch.tv/helix/users', {
    headers: { Authorization: `Bearer ${token}`, 'Client-ID': CLIENT_ID },
  })
    .then((r) => r.json())
    .then((data) => {
      if (data.data && data.data[0]) {
        currentUser = data.data[0];
        localStorage.setItem('twitchUser', JSON.stringify(currentUser));
        updateUserWidget();
        window.location.hash = '';
        route();
      }
    })
    .catch(console.error);
}

function loginWithTwitch() {
  window.location.href = `https://id.twitch.tv/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=token&scope=user:read:email`;
}

function logout() {
  currentUser = null;
  localStorage.removeItem('twitchUser');
  updateUserWidget();
  route();
}

function updateUserWidget() {
  const widget = document.getElementById('userWidget');
  if (!widget) return;
  if (currentUser) {
    widget.innerHTML = `<div style="display:flex;align-items:center;gap:10px;background:rgba(145,71,255,0.2);padding:10px;border-radius:40px;">
      <img src="${escapeHtml(currentUser.profile_image_url)}" style="width:32px;height:32px;border-radius:50%;" alt="">
      <span style="font-weight:500;">${escapeHtml(currentUser.display_name)}</span>
      <button type="button" onclick="logout()" style="background:none;border:none;color:#ff6b6b;cursor:pointer;" title="${T('out')}">🚪</button>
    </div>`;
  } else {
    widget.innerHTML = `<button class="btn-primary" style="width:100%;" type="button" onclick="loginWithTwitch()">🔐 ${T('login')}</button>`;
  }
}

async function apiFetch(url, opts) {
  const res = await fetch(url, opts);
  return res.json();
}

async function fetchPosts() {
  try {
    const vid = currentUser?.id || '';
    const res = await fetch(`${API_BASE}?action=posts&viewerId=${encodeURIComponent(vid)}`);
    if (!res.ok) throw new Error('http');
    allPosts = await res.json();
  } catch {
    allPosts = [];
  }
}

async function fetchComments(postId) {
  try {
    const res = await fetch(`${API_BASE}?action=comments&postId=${encodeURIComponent(postId)}`);
    if (!res.ok) throw new Error('http');
    allComments[postId] = await res.json();
  } catch {
    allComments[postId] = [];
  }
}

async function postView(postId) {
  try {
    await fetch(`${API_BASE}?action=view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId }),
    });
  } catch (_) {}
}

function pushViewHistory(id) {
  let h = JSON.parse(localStorage.getItem('honesty113_views') || '[]');
  h = [id, ...h.filter((x) => x !== id)].slice(0, 40);
  localStorage.setItem('honesty113_views', JSON.stringify(h));
}

async function fetchStreamBanner() {
  try {
    const res = await fetch(`${API_BASE}?action=stream`);
    const d = await res.json();
    return d;
  } catch {
    return { live: false };
  }
}

function filterPostsBase(list) {
  let out = [...list];
  const now = Date.now();
  const week = 7 * 86400000;
  const day = 86400000;
  if (feedFilters.time === 'today') out = out.filter((p) => now - postTimeMs(p) < day);
  else if (feedFilters.time === 'week') out = out.filter((p) => now - postTimeMs(p) < week);
  else if (feedFilters.time === 'month') out = out.filter((p) => now - postTimeMs(p) < 30 * day);

  if (feedFilters.type === 'image') out = out.filter((p) => safeMediaUrl(p.mediaUrl));
  else if (feedFilters.type === 'video') {
    out = out.filter((p) => p.category === 'Видео' || /youtube|youtu\.be|twitch\.tv\/videos/i.test(p.link || ''));
  }
  if (feedFilters.streamOnly) out = out.filter((p) => !p.notForStream);

  if (feedFilters.category && feedFilters.category !== 'all') {
    out = out.filter((p) => p.category === feedFilters.category);
  }

  if (feedFilters.author) {
    const q = feedFilters.author.toLowerCase();
    out = out.filter((p) => (p.nick || '').toLowerCase().includes(q) || (p.authorId || '') === q);
  }
  return out;
}

function sortPosts(list, mode) {
  const a = [...list];
  if (mode === 'rating' || feedFilters.sort === 'best') a.sort((x, y) => (y.rating || 0) - (x.rating || 0));
  else if (mode === 'views') a.sort((x, y) => (y.views || 0) - (x.views || 0));
  else if (mode === 'comments') {
    a.sort((x, y) => (allComments[y.id]?.length || 0) - (allComments[x.id]?.length || 0));
  } else if (mode === 'old') a.sort((x, y) => postTimeMs(x) - postTimeMs(y));
  else a.sort((x, y) => postTimeMs(y) - postTimeMs(x));
  return a;
}

function getCategoryEmoji(cat) {
  const map = {
    Видео: '🎬', Фильм: '🎥', Аниме: '🍥', Сериал: '📺', Игра: '🎮', Другое: '✨',
    Клипы: '📎', Музыка: '🎵', IRL: '📷', Арт: '🎨', Мемы: '😹',
  };
  return map[cat] || '✨';
}

function renderToolbar(title) {
  return `<div class="feed-toolbar card">
    <h2 class="feed-title">${title}</h2>
    <div class="toolbar-rows">
      <div class="toolbar-row">
        <label class="tb-label">Категория</label>
        <input type="text" id="tbCategory" class="input-modern tb-input" list="categoryPresets" placeholder="Все" title="Пусто = все категории">
        <label class="tb-label">Тип</label>
        <select id="tbType" class="input-modern tb-select">
          <option value="all">Всё</option>
          <option value="image">С картинкой</option>
          <option value="video">Видео-ссылки</option>
        </select>
        <label class="tb-label">Сорт</label>
        <select id="tbSort" class="input-modern tb-select">
          <option value="new">Новые</option>
          <option value="best">Лучшие</option>
          <option value="views">По просмотрам</option>
          <option value="comments">По комментам</option>
        </select>
        <label class="tb-label">Период</label>
        <select id="tbTime" class="input-modern tb-select">
          <option value="all">Всё время</option>
          <option value="today">Сегодня</option>
          <option value="week">Неделя</option>
          <option value="month">Месяц</option>
        </select>
      </div>
      <div class="toolbar-row">
        <label class="tb-label">Автор</label>
        <input type="text" id="tbAuthor" class="input-modern tb-input" placeholder="ник или ID">
        <label class="tb-check"><input type="checkbox" id="tbStreamSafe"> Только для стрима</label>
        ${currentUser ? '<button type="button" class="btn-primary" id="newPostBtn">➕ Новая предложка</button>' : ''}
        <button type="button" class="btn-primary btn-secondary" id="btnRandomPost">🎲 Случайный пост</button>
      </div>
    </div>
  </div>`;
}

function wireToolbar() {
  const g = (id) => document.getElementById(id);
  if (!feedFilters.category) feedFilters.category = 'all';
  if (g('tbType')) {
    const catIn = g('tbCategory');
    catIn.value = feedFilters.category === 'all' ? '' : (feedFilters.category || '');
    g('tbType').value = feedFilters.type;
    g('tbSort').value = feedFilters.sort;
    g('tbTime').value = feedFilters.time;
    g('tbAuthor').value = feedFilters.author;
    g('tbStreamSafe').checked = !!feedFilters.streamOnly;
    const save = () => {
      const cv = (catIn.value || '').trim();
      feedFilters.category = cv ? cv : 'all';
      feedFilters.type = g('tbType').value;
      feedFilters.sort = g('tbSort').value;
      feedFilters.time = g('tbTime').value;
      feedFilters.author = g('tbAuthor').value.trim();
      feedFilters.streamOnly = g('tbStreamSafe').checked;
      saveFeedFilters();
      feedDisplayCount = PAGE_SIZE;
      route();
    };
    ['tbType', 'tbSort', 'tbTime'].forEach((id) => g(id).addEventListener('change', save));
    catIn.addEventListener('change', save);
    catIn.addEventListener('blur', save);
    g('tbAuthor').addEventListener('change', save);
    g('tbStreamSafe').addEventListener('change', save);
    const np = g('newPostBtn');
    if (np) np.onclick = () => openPostModal();
    g('btnRandomPost').onclick = () => {
      const pool = filterPostsBase(allPosts);
      if (!pool.length) return alert('Нет постов');
      const p = pool[Math.floor(Math.random() * pool.length)];
      setRoute('feed', p.id);
    };
  }
}

function renderCompactCard(post) {
  const comments = allComments[post.id] || [];
  const isMine = currentUser && post.authorId === currentUser.id;
  const mediaSrc = safeMediaUrl(post.mediaUrl);
  const censored = post.notForStream && !settings.allowNsfwStream && mediaSrc;
  const thumb = mediaSrc
    ? `<div class="compact-thumb ${censored ? 'compact-thumb--blur' : ''}"><img src="${mediaSrc.replace(/"/g, '&quot;')}" alt=""></div>`
    : '<div class="compact-thumb compact-thumb--empty">📄</div>';
  const snippet = escapeHtml((post.text || '').slice(0, 120)) + ((post.text || '').length > 120 ? '…' : '');
  return `<article class="forum-row card ${isMine ? 'post-own' : ''}" data-open-thread="${post.id}">
    ${thumb}
    <div class="forum-row-main">
      <div class="forum-row-title">${escapeHtml(post.title || 'Без названия')}</div>
      <div class="forum-row-meta">${escapeHtml(post.nick)} · ${post.date} · 👁 ${post.views || 0} · 👍 ${post.rating || 0} · 💬 ${comments.length}</div>
      <div class="forum-row-snippet">${snippet}</div>
      <div class="forum-row-tags">
        <button type="button" class="post-tag tag-click" data-cat-filter="${escapeHtml(post.category)}">${getCategoryEmoji(post.category)} ${escapeHtml(post.category)}</button>
        ${post.game ? `<button type="button" class="post-tag tag-click" data-game-filter="${escapeHtml(post.game)}">🎮 ${escapeHtml(post.game)}</button>` : ''}
        ${post.status === 'pending' ? '<span class="post-tag nsfw-tag">⏳ модерация</span>' : ''}
      </div>
    </div>
  </article>`;
}

function renderLinkPreviewBox(url) {
  if (!url || !safeExternalUrl(url)) return '';
  const h = linkHostname(url);
  return `<a href="${safeExternalUrl(url)}" target="_blank" rel="noopener noreferrer" class="link-preview-box">
    <span class="lp-icon">🔗</span>
    <div><div class="lp-host">${escapeHtml(h)}</div><div class="lp-url">${escapeHtml(url.slice(0, 80))}${url.length > 80 ? '…' : ''}</div></div>
  </a>`;
}

function renderThreadMedia(post) {
  const mediaSrc = safeMediaUrl(post.mediaUrl);
  if (!mediaSrc) return '';
  const censored = post.notForStream && !settings.allowNsfwStream;
  return `<div class="post-media-wrap ${censored ? 'post-media--censored' : ''}">
    <img src="${mediaSrc.replace(/"/g, '&quot;')}" alt="">
    ${censored ? '<div class="post-media-hint">🔞 Включите показ в настройках</div>' : ''}
  </div>`;
}

async function renderThread(postId) {
  showLoader();
  await fetchPosts();
  await fetchComments(postId);
  const post = allPosts.find((p) => p.id === postId);
  hideLoader();
  const main = document.getElementById('mainContent');
  if (!post) {
    main.innerHTML = '<div class="card"><p>Пост не найден или скрыт.</p><button type="button" class="btn-primary" onclick="setRoute(\'feed\',\'\')">← К ленте</button></div>';
    return;
  }
  postView(postId);
  pushViewHistory(postId);

  const isMine = currentUser && post.authorId === currentUser.id;
  const modPwd = sessionStorage.getItem('adminPwd') || '';
  const canModDelete = !!modPwd;
  const comments = allComments[postId] || [];
  const shareUrl = `${window.location.origin}${window.location.pathname}?thread=${postId}`;

  let walletCoins = 0;
  if (currentUser) {
    try {
      const w = await apiFetch(`${API_BASE}?action=wallet&userId=${encodeURIComponent(currentUser.id)}`);
      walletCoins = w.coins || 0;
    } catch (_) {}
  }

  const listPage = new URLSearchParams(window.location.search).get('page') || 'feed';
  main.innerHTML = `
    <div class="thread-nav">
      <button type="button" class="btn-primary btn-secondary" id="backFeed">← Назад</button>
      <button type="button" class="btn-primary btn-secondary" id="copyLinkBtn">📋 Ссылка</button>
      ${isMine ? `<button type="button" class="btn-primary btn-secondary" id="editPostBtn">✏️ Изменить</button>
      <button type="button" class="btn-primary btn-secondary" id="delPostBtn" style="border-color:#ff6b6b;color:#ff6b6b;">🗑 Удалить</button>` : ''}
      ${canModDelete ? `<button type="button" class="btn-primary btn-secondary" id="modDelPostBtn" style="border-color:#c44;">🛡 Снять с публикации</button>` : ''}
    </div>
    <article class="card thread-article ${isMine ? 'post-own' : ''}">
      <div class="post-header">
        <img class="post-avatar" src="${post.avatar || 'https://static-cdn.jtvnw.net/user-default-pictures-uv/13e5d884-3c7e-4c9a-9c6c-6f3c6d5f8e6a-profile_image-70x70.png'}" alt="">
        <div>
          <div class="post-author">${escapeHtml(post.nick)}</div>
          <div class="post-time">${post.date} · 👁 ${post.views || 0} просмотров</div>
        </div>
      </div>
      ${renderThreadMedia(post)}
      <h1 class="thread-h1">${escapeHtml(post.title || '')}</h1>
      <div class="post-content thread-body">${escapeHtml(post.text || '')}</div>
      ${post.coAuthors ? `<p class="coauthors">👥 Соавторы: ${escapeHtml(post.coAuthors)}</p>` : ''}
      <div class="thread-tags">
        <span class="post-tag">${getCategoryEmoji(post.category)} ${escapeHtml(post.category)}</span>
        ${post.notForStream ? '<span class="post-tag nsfw-tag">🔞 не для стрима</span>' : ''}
        ${post.game ? `<span class="post-tag">🎮 ${escapeHtml(post.game)}</span>` : ''}
      </div>
      ${renderLinkPreviewBox(post.link)}
      <div class="post-stats thread-actions">
        <button type="button" class="stat-btn" id="thUp">👍 ${post.rating || 0}</button>
        <button type="button" class="stat-btn" id="thDown">👎</button>
        <span class="stat-btn" style="cursor:default;">💬 ${comments.length}</span>
        ${currentUser ? `<span class="boost-inline"><label class="boost-label">🪙 <input type="number" id="boostAmount" class="input-modern boost-amt" min="1" max="1000" value="1" title="Сколько монет потратить"></label><button type="button" class="stat-btn" id="thBoost" title="1 монета = +1 к рейтингу">🚀 Продвинуть · на балансе ${walletCoins}</button></span>` : ''}
      </div>
      <div class="comment-section thread-comments">
        <h3>Комментарии</h3>
        <div id="threadCommentsList">${comments.map((c) => renderCommentBlock(c)).join('')}</div>
        ${currentUser ? `<div class="reply-hint" id="replyHint" style="display:none;"></div>
        <div class="sticker-bar">${STICKERS.map((s) => `<button type="button" class="sticker-btn" data-sticker="${s.e}" title="${escapeHtml(s.name)}">${s.e}</button>`).join('')}</div>
        <textarea id="threadCommentInput" class="input-modern" rows="3" placeholder="Комментарий…"></textarea>
        <button type="button" class="btn-primary" id="threadCommentSend">Отправить</button>` : '<p class="hint-login">Войдите через Twitch, чтобы комментировать</p>'}
      </div>
    </article>`;

  document.getElementById('backFeed').onclick = () => setRoute(listPage, '');
  document.getElementById('copyLinkBtn').onclick = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      alert('Ссылка скопирована');
    } catch {
      prompt('Копируйте:', shareUrl);
    }
  };
  if (isMine) {
    document.getElementById('editPostBtn').onclick = () => openEditModal(post);
    document.getElementById('delPostBtn').onclick = () => openDeleteModal(postId);
  }
  document.getElementById('modDelPostBtn')?.addEventListener('click', async () => {
    if (!modPwd || !confirm('Снять пост с публикации?')) return;
    const r = await apiFetch(`${API_BASE}?action=deletePost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postId,
        userId: currentUser?.id || 'mod',
        adminPassword: modPwd,
      }),
    });
    if (r.error) alert(r.error);
    else setRoute('feed', '');
  });
  const uid = currentUser?.id;
  document.getElementById('thUp').onclick = async () => {
    if (!currentUser) return loginWithTwitch();
    const res = await apiFetch(`${API_BASE}?action=vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId, type: 'up', userId: uid }),
    });
    if (res.success) renderThread(postId);
  };
  document.getElementById('thDown').onclick = async () => {
    if (!currentUser) return loginWithTwitch();
    await apiFetch(`${API_BASE}?action=vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId, type: 'down', userId: uid }),
    });
    renderThread(postId);
  };
  const boost = document.getElementById('thBoost');
  if (boost) {
    boost.onclick = async () => {
      const inp = document.getElementById('boostAmount');
      const amount = Math.min(1000, Math.max(1, parseInt(inp?.value, 10) || 1));
      if (inp) inp.value = String(amount);
      const r = await apiFetch(`${API_BASE}?action=boost`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, userId: uid, amount }),
      });
      if (r.error) alert(r.error);
      else renderThread(postId);
    };
  }
  document.querySelectorAll('.sticker-btn').forEach((b) => {
    b.onclick = () => {
      const ta = document.getElementById('threadCommentInput');
      ta.value += b.dataset.sticker;
      ta.focus();
    };
  });
  document.querySelectorAll('.quote-btn').forEach((b) => {
    b.onclick = () => {
      const nick = b.dataset.nick;
      const ex = b.dataset.excerpt;
      replyTarget = { nick, excerpt: ex };
      const h = document.getElementById('replyHint');
      h.style.display = 'block';
      h.textContent = `Ответ для @${nick}`;
      document.getElementById('threadCommentInput').focus();
    };
  });
  document.getElementById('threadCommentSend')?.addEventListener('click', async () => {
    const ta = document.getElementById('threadCommentInput');
    const text = ta.value.trim();
    if (!text) return;
    let meta = '';
    if (replyTarget) meta = `${replyTarget.nick}¶${(replyTarget.excerpt || '').slice(0, 120)}`;
    await apiFetch(`${API_BASE}?action=addComment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postId,
        text,
        userId: currentUser.id,
        nick: currentUser.display_name,
        avatar: currentUser.profile_image_url,
        replyMeta: meta,
      }),
    });
    replyTarget = null;
    ta.value = '';
    const rh = document.getElementById('replyHint');
    if (rh) rh.style.display = 'none';
    renderThread(postId);
  });

}

function renderCommentBlock(c) {
  const full = c.text || '';
  const needTrunc = full.length > 220;
  const quote = c.replyToNick
    ? `<div class="comment-quote">↪ ${escapeHtml(c.replyToNick)}: ${escapeHtml(c.replyExcerpt || '…')}</div>`
    : '';
  const body = formatCommentHtml(needTrunc ? full.slice(0, 220) : full) + (needTrunc ? '…' : '');
  const expand = needTrunc
    ? `<span class="comment-long-full" style="display:none">${escapeHtml(full)}</span><button type="button" class="comment-more">ещё</button>`
    : '';
  return `<div class="comment">
    <img class="comment-avatar" src="${c.avatar || 'https://static-cdn.jtvnw.net/user-default-pictures-uv/13e5d884-3c7e-4c9a-9c6c-6f3c6d5f8e6a-profile_image-70x70.png'}" alt="">
    <div class="comment-bubble">
      <div class="comment-meta"><strong>${escapeHtml(c.nick)}</strong> · ${c.date}
        <button type="button" class="quote-btn" data-nick="${escapeHtml(c.nick)}" data-excerpt="${escapeHtml((c.text || '').slice(0, 80))}">↩</button>
      </div>
      ${quote}
      <div class="comment-text">${body}</div>
      ${expand}
    </div>
  </div>`;
}

async function renderFeedPage() {
  showLoader();
  const banner = await fetchStreamBanner();
  await fetchPosts();
  await Promise.all(allPosts.map((p) => fetchComments(p.id)));
  hideLoader();

  let filtered = filterPostsBase(allPosts);
  if (feedFilters.sort === 'best' && feedFilters.time === 'week') {
    const weekMs = 7 * 86400000;
    const now = Date.now();
    filtered = filtered.filter((p) => now - postTimeMs(p) < weekMs);
  }
  filtered = sortPosts(filtered, feedFilters.sort === 'best' ? 'rating' : feedFilters.sort === 'views' ? 'views' : feedFilters.sort === 'comments' ? 'comments' : 'new');
  feedDisplayCount = Math.min(feedDisplayCount, filtered.length);
  const slice = filtered.slice(0, Math.max(feedDisplayCount, PAGE_SIZE));

  const main = document.getElementById('mainContent');
  main.innerHTML = `${renderStreamStrip(banner)}${renderToolbar('🎯 Предложки')}
    <div id="feedPosts">${slice.map(renderCompactCard).join('')}</div>
    ${slice.length < filtered.length ? `<div class="load-more-wrap"><button type="button" class="btn-primary btn-secondary" id="loadMoreBtn">Загрузить ещё</button></div>` : ''}`;

  wireToolbar();
  document.getElementById('loadMoreBtn')?.addEventListener('click', () => {
    feedDisplayCount += PAGE_SIZE;
    renderFeedPage();
  });
  main.querySelectorAll('[data-open-thread]').forEach((el) => {
    el.addEventListener('click', () => setRoute(getRoute().page || 'feed', el.dataset.openThread));
  });
  main.querySelectorAll('.tag-click').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (b.dataset.catFilter) {
        feedFilters.category = b.dataset.catFilter;
        saveFeedFilters();
        feedDisplayCount = PAGE_SIZE;
        setRoute('feed', '');
      }
    });
  });
}

function renderStreamStrip(d) {
  if (!d.live) {
    return `<div class="stream-strip card stream-offline">📺 Сейчас офлайн · <a href="https://twitch.tv/honesty113" target="_blank" rel="noopener">канал</a></div>`;
  }
  return `<div class="stream-strip card stream-live">🔴 В эфире · <strong>${escapeHtml(d.game || 'Twitch')}</strong> — ${escapeHtml(d.title || '')} · 👁 ${d.viewerCount || 0}</div>`;
}

async function renderVideosPage() {
  feedFilters = { ...feedFilters, type: 'video' };
  showLoader();
  await fetchPosts();
  await Promise.all(allPosts.map((p) => fetchComments(p.id)));
  hideLoader();
  let filtered = filterPostsBase(allPosts);
  filtered = sortPosts(filtered, 'new');
  const main = document.getElementById('mainContent');
  main.innerHTML = `${renderToolbar('🎬 Видео-предложки')}
    <p class="hint-bar">Сюда попадают категория «Видео» или ссылки на YouTube/Twitch VOD.</p>
    <div id="feedPosts">${filtered.map(renderCompactCard).join('')}</div>`;
  wireToolbar();
  main.querySelectorAll('[data-open-thread]').forEach((el) => {
    el.addEventListener('click', () => setRoute('videos', el.dataset.openThread));
  });
}

async function renderDiscoverPage() {
  await fetchPosts();
  await Promise.all(allPosts.map((p) => fetchComments(p.id)));
  const byCat = {};
  allPosts.forEach((p) => {
    byCat[p.category] = (byCat[p.category] || 0) + 1;
  });
  const authors = {};
  allPosts.forEach((p) => {
    const k = p.nick || p.authorId;
    if (!authors[k]) authors[k] = { nick: p.nick, rating: 0, count: 0 };
    authors[k].rating += p.rating || 0;
    authors[k].count += 1;
  });
  const top = Object.values(authors).sort((a, b) => b.rating - a.rating).slice(0, 15);
  const catsHtml = Object.entries(byCat)
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `<div class="stat-row"><span>${escapeHtml(c)}</span><b>${n}</b></div>`)
    .join('');
  const topHtml = top
    .map((u, i) => `<div class="stat-row"><span>${i + 1}. ${escapeHtml(u.nick)}</span><b>${u.rating} 👍 / ${u.count} постов</b></div>`)
    .join('');
  document.getElementById('mainContent').innerHTML = `<div class="card"><h2>📊 Категории</h2><div class="stat-list">${catsHtml}</div></div>
    <div class="card"><h2>🏆 Рейтинг авторов</h2><div class="stat-list">${topHtml}</div></div>
    <div class="card"><h2>🎲 Идея дня</h2><p>Случайная из лучших за неделю</p>
    <button type="button" class="btn-primary" id="ideaDayBtn">Показать</button><div id="ideaDayOut"></div></div>`;
  document.getElementById('ideaDayBtn').onclick = () => {
    const weekMs = 7 * 86400000;
    const now = Date.now();
    const pool = allPosts.filter((p) => now - postTimeMs(p) < weekMs).sort((a, b) => (b.rating || 0) - (a.rating || 0));
    const pick = pool[Math.floor(Math.random() * Math.min(pool.length, 20))] || allPosts[Math.floor(Math.random() * allPosts.length)];
    document.getElementById('ideaDayOut').innerHTML = pick
      ? `<div class="card" style="margin-top:12px;cursor:pointer" data-open-thread="${pick.id}"><strong>${escapeHtml(pick.title)}</strong><p>${escapeHtml((pick.text || '').slice(0, 200))}</p></div>`
      : '';
    document.querySelector('#ideaDayOut [data-open-thread]')?.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.openThread;
      setRoute('discover', id);
    });
  };
}

async function renderCalendar() {
  const container = document.getElementById('mainContent');
  container.innerHTML = '<div class="loading">Загрузка…</div>';
  try {
    const res = await fetch(`${API_BASE}?action=vods`);
    const vods = await res.json();
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    let html = '<div class="card"><h2>📅 Календарь стримов</h2><div class="calendar-grid">';
    for (let i = 0; i < firstDay; i++) html += '<div></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${d}.${month + 1}.${year}`;
      const hasVod = vods.some((v) => v.date === dateStr);
      const vodUrl = hasVod ? vods.find((v) => v.date === dateStr).url : 'https://twitch.tv/honesty113';
      html += `<div class="calendar-day ${hasVod ? 'has-vod' : ''}" onclick="window.open('${vodUrl}','_blank')">${d}</div>`;
    }
    container.innerHTML = html + '</div></div>';
  } catch {
    container.innerHTML = '<div class="card"><p>Ошибка календаря</p></div>';
  }
}

function renderLinks() {
  document.getElementById('mainContent').innerHTML = `<div class="card"><h2>🔗 Ссылки</h2>
    <div class="links-grid">
      <a href="https://twitch.tv/honesty113" target="_blank" class="link-card"><div class="link-icon">📺</div><div class="link-name">Twitch</div></a>
      <a href="https://t.me/hoststreet" target="_blank" class="link-card"><div class="link-icon">📱</div><div class="link-name">Telegram</div></a>
      <a href="https://discord.gg/ynDWeAYB2" target="_blank" class="link-card"><div class="link-icon">💬</div><div class="link-name">Discord</div></a>
    </div></div>`;
}

function renderSettings() {
  document.getElementById('mainContent').innerHTML = `<div class="card"><h2>⚙️ Настройки</h2>
    <div class="settings-group"><span class="settings-label">Тема</span>
      <div class="settings-options">
        <div class="settings-option ${settings.theme === 'dark' ? 'active' : ''}" data-s="theme" data-v="dark">Тёмная</div>
        <div class="settings-option ${settings.theme === 'light' ? 'active' : ''}" data-s="theme" data-v="light">Светлая</div>
      </div></div>
    <div class="settings-group"><span class="settings-label">Шрифт</span>
      <div class="settings-options">
        <div class="settings-option ${settings.fontFamily === 'system' ? 'active' : ''}" data-s="font" data-v="system">Системный</div>
        <div class="settings-option ${settings.fontFamily === 'inter' ? 'active' : ''}" data-s="font" data-v="inter">Inter</div>
        <div class="settings-option ${settings.fontFamily === 'mono' ? 'active' : ''}" data-s="font" data-v="mono">Моно</div>
        <div class="settings-option ${settings.fontFamily === 'serif' ? 'active' : ''}" data-s="font" data-v="serif">С засечками</div>
      </div></div>
    <div class="settings-group"><span class="settings-label">Размер текста</span>
      <div class="settings-options">
        <div class="settings-option ${settings.fontSize === 'small' ? 'active' : ''}" data-s="fs" data-v="small">Меньше</div>
        <div class="settings-option ${settings.fontSize === 'medium' ? 'active' : ''}" data-s="fs" data-v="medium">Обычный</div>
        <div class="settings-option ${settings.fontSize === 'large' ? 'active' : ''}" data-s="fs" data-v="large">Крупнее</div>
      </div></div>
    <div class="settings-group"><span class="settings-label">Язык интерфейса</span>
      <div class="settings-options">
        <div class="settings-option ${settings.language === 'ru' ? 'active' : ''}" data-s="lang" data-v="ru">Русский</div>
        <div class="settings-option ${settings.language === 'en' ? 'active' : ''}" data-s="lang" data-v="en">English</div>
      </div></div>
    <div class="settings-group"><span class="settings-label">Анимации</span>
      <div class="settings-options">
        <div class="settings-option ${settings.animations ? 'active' : ''}" data-s="anim" data-v="1">Вкл</div>
        <div class="settings-option ${!settings.animations ? 'active' : ''}" data-s="anim" data-v="0">Выкл</div>
      </div></div>
    <div class="settings-group"><span class="settings-label">🔞 «Не для стрима»</span>
      <div class="settings-options">
        <div class="settings-option ${!settings.allowNsfwStream ? 'active' : ''}" data-s="nsfw" data-v="0">С блюром</div>
        <div class="settings-option ${settings.allowNsfwStream ? 'active' : ''}" data-s="nsfw" data-v="1">Показывать</div>
      </div></div>
  </div>`;
  document.querySelectorAll('.settings-option').forEach((o) => {
    o.onclick = () => {
      const s = o.dataset.s;
      const v = o.dataset.v;
      if (s === 'theme') settings.theme = v;
      if (s === 'font') settings.fontFamily = v;
      if (s === 'fs') settings.fontSize = v;
      if (s === 'lang') settings.language = v;
      if (s === 'anim') settings.animations = v === '1';
      if (s === 'nsfw') {
        if (v === '1' && !confirm('Показывать такой контент без размытия?')) return;
        settings.allowNsfwStream = v === '1';
      }
      saveSettings();
      renderSettings();
    };
  });
}

function categoryKey(label) {
  return String(label || '').trim().toLowerCase();
}

function buildBadgeContext(myPosts, commentsOnMine, writtenComments) {
  const postCount = myPosts.length;
  const ratingSum = myPosts.reduce((s, p) => s + (p.rating || 0), 0);
  const catCount = {};
  myPosts.forEach((p) => {
    const k = categoryKey(p.category || 'Другое');
    catCount[k] = (catCount[k] || 0) + 1;
  });
  const fullText = (p) => `${p.title || ''} ${p.text || ''}`;
  const hasRegex = (pat) => {
    try {
      const re = new RegExp(pat, 'i');
      return myPosts.some((p) => re.test(fullText(p)));
    } catch {
      return false;
    }
  };
  const anyLink = myPosts.some((p) => (p.link || '').trim().length > 4);
  const postDates = myPosts.map((p) => {
    const t = Number(p.id);
    return Number.isFinite(t) ? new Date(t) : null;
  }).filter(Boolean);
  const hourOk = (h) => postDates.some((d) => d.getHours() === h);
  const monthOk = (m) => postDates.some((d) => d.getMonth() === m);
  return {
    postCount,
    ratingSum,
    catCount,
    commentsOnMine,
    writtenComments,
    hasRegex,
    anyLink,
    hourOk,
    monthOk,
  };
}

function badgeUnlocked(b, ctx) {
  switch (b.kind) {
    case 'posts':
      return ctx.postCount >= b.min;
    case 'rating_sum':
      return ctx.ratingSum >= b.min;
    case 'comments_written':
      return ctx.writtenComments >= b.min;
    case 'comments_on_mine':
      return ctx.commentsOnMine >= b.min;
    case 'category':
      return (ctx.catCount[categoryKey(b.category)] || 0) >= b.min;
    case 'text_regex':
      return ctx.hasRegex(b.pattern);
    case 'any_link':
      return ctx.anyLink;
    case 'post_hour':
      return ctx.hourOk(b.hour);
    case 'post_month':
      return ctx.monthOk(b.month);
    case 'never':
      return false;
    default:
      return false;
  }
}

function renderBadgesPanel(ctx) {
  const manifest = typeof window !== 'undefined' && window.BADGE_MANIFEST;
  if (!manifest || !manifest.length) {
    return '<p class="hint-bar">Список значков загружается…</p>';
  }
  let unlocked = 0;
  let totalCountable = 0;
  manifest.forEach((b) => {
    if (b.secret) return;
    totalCountable += 1;
    if (badgeUnlocked(b, ctx)) unlocked += 1;
  });
  const bySection = new Map();
  manifest.forEach((b) => {
    if (!bySection.has(b.section)) bySection.set(b.section, []);
    bySection.get(b.section).push(b);
  });
  const order = [...bySection.keys()];
  let html = `<p class="hint-bar" style="margin-bottom:8px;">Наведи курсор — подсказка, как получить.</p>
    <p class="badge-progress">Открыто: ${unlocked} / ${totalCountable}</p>`;
  order.forEach((sec) => {
    html += `<div class="badge-section-title">${escapeHtml(sec)}</div><div class="badge-grid">`;
    bySection.get(sec).forEach((b) => {
      const on = badgeUnlocked(b, ctx);
      let title;
      if (b.secret && !on) {
        title = 'Секретный значок. Условие можно будет открыть за монеты (скоро).';
      } else {
        title = b.hint || b.name;
      }
      const cls = ['badge-cell', on ? 'unlocked' : 'locked'];
      if (b.secret) cls.push('secret-b');
      const showEmoji = b.secret && !on ? '❔' : b.emoji;
      html += `<div class="${cls.join(' ')}" title="${escapeHtml(title)}">
        <span class="badge-emoji">${showEmoji}</span>
        <span class="badge-name">${escapeHtml(b.name)}</span>
      </div>`;
    });
    html += '</div>';
  });
  return html;
}

async function renderProfile() {
  if (!currentUser) {
    document.getElementById('mainContent').innerHTML = '<div class="card"><p>Войдите через Twitch</p><button type="button" class="btn-primary" onclick="loginWithTwitch()">Войти</button></div>';
    return;
  }
  await fetchPosts();
  await Promise.all(allPosts.map((p) => fetchComments(p.id)));
  const myPosts = allPosts.filter((p) => p.authorId === currentUser.id);
  const commentsOnMine = myPosts.reduce((s, p) => s + (allComments[p.id]?.length || 0), 0);
  let writtenComments = 0;
  try {
    const st = await apiFetch(`${API_BASE}?action=userStats&userId=${encodeURIComponent(currentUser.id)}`);
    writtenComments = st.writtenComments || 0;
  } catch (_) {}
  let coins = 0;
  try {
    const w = await apiFetch(`${API_BASE}?action=wallet&userId=${encodeURIComponent(currentUser.id)}`);
    coins = w.coins || 0;
  } catch (_) {}
  const histIds = JSON.parse(localStorage.getItem('honesty113_views') || '[]').slice(0, 8);
  const histPosts = histIds.map((id) => allPosts.find((p) => p.id === id)).filter(Boolean);

  const ctx = buildBadgeContext(myPosts, commentsOnMine, writtenComments);
  const badgesHtml = renderBadgesPanel(ctx);

  document.getElementById('mainContent').innerHTML = `<div class="card profile-layout">
    <div class="profile-main">
    <div class="profile-header">
      <img src="${escapeHtml(currentUser.profile_image_url)}" class="profile-avatar" alt="">
      <div><h2>${escapeHtml(currentUser.display_name)}</h2><p>🪙 ${coins} монет</p></div>
    </div>
    <div class="profile-stats">
      <div class="profile-stat"><div class="profile-stat-value">${myPosts.length}</div><div class="profile-stat-label">Постов</div></div>
      <div class="profile-stat"><div class="profile-stat-value">${ctx.ratingSum}</div><div class="profile-stat-label">Сумма 👍</div></div>
      <div class="profile-stat"><div class="profile-stat-value">${commentsOnMine}</div><div class="profile-stat-label">Комментов к моим</div></div>
      <div class="profile-stat"><div class="profile-stat-value">${writtenComments}</div><div class="profile-stat-label">Моих комментов</div></div>
    </div>
    <h3 style="margin-top:20px;">Недавно смотрели</h3>
    ${histPosts.length ? histPosts.map((p) => `<div class="hist-row" data-open-thread="${p.id}">${escapeHtml(p.title || p.text.slice(0, 40))}</div>`).join('') : '<p>Пусто</p>'}
    <button type="button" class="btn-primary" style="margin-top:16px" onclick="logout()">Выйти</button>
    </div>
    <aside class="profile-badges-aside">
      <h3 style="margin:0 0 4px;">Значки</h3>
      ${badgesHtml}
    </aside>
  </div>`;
  document.querySelectorAll('.hist-row').forEach((el) => {
    el.onclick = () => setRoute('profile', el.dataset.openThread);
  });
}

function exitModMode() {
  stopAdminPoll();
  sessionStorage.removeItem('adminPwd');
  renderAdmin();
}

async function renderAdmin() {
  const pwd = sessionStorage.getItem('adminPwd') || '';
  document.getElementById('mainContent').innerHTML = `<div class="card mod-page">
    <h2>🛡 Панель модерации</h2>
    <div id="adminLoginBlock">
      <input type="password" id="adminPwdIn" class="input-modern" placeholder="Пароль" autocomplete="current-password">
      <button type="button" class="btn-primary" id="adminLoginBtn" style="margin-top:12px;">Войти</button>
    </div>
    <div id="adminPanel" style="display:none;margin-top:20px;">
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:16px;">
        <span id="modLiveBadge" class="post-tag" style="background:rgba(255,68,102,0.2);">● Очередь обновляется</span>
        <button type="button" class="btn-primary btn-secondary" id="modExitBtn">Выйти из режима модератора</button>
      </div>
      <div class="mod-layout">
        <div>
          <h3>На проверке <span id="modPendingCount">0</span></h3>
          <div id="modQueue"></div>
        </div>
        <div>
          <h3>Люди</h3>
          <p class="hint-bar" style="margin-bottom:10px;">Поиск по нику или Twitch ID</p>
          <input type="text" id="userSearchQ" class="input-modern" placeholder="Начните вводить…">
          <button type="button" class="btn-primary" id="userSearchBtn" style="margin-top:8px;">Найти</button>
          <div id="userSearchHits" style="margin-top:12px;max-height:280px;overflow-y:auto;"></div>
          <div id="modUserCard" class="mod-user-card" style="display:none;">
            <div id="modUserCardInner"></div>
          </div>
        </div>
      </div>
    </div></div>`;

  document.getElementById('modExitBtn')?.addEventListener('click', exitModMode);

  document.getElementById('adminLoginBtn').onclick = async () => {
    const p = document.getElementById('adminPwdIn').value;
    const r = await apiFetch(`${API_BASE}?action=adminPing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPassword: p }),
    });
    if (!r.ok) {
      alert('Неверный пароль');
      return;
    }
    sessionStorage.setItem('adminPwd', p);
    document.getElementById('adminLoginBlock').style.display = 'none';
    document.getElementById('adminPanel').style.display = 'block';
    await loadModQueue(p);
    window.__adminPoll = setInterval(() => loadModQueue(p), 1000);
  };

  if (pwd) {
    document.getElementById('adminPwdIn').value = pwd;
    document.getElementById('adminLoginBtn').click();
  }

  let selectedUser = null;

  async function runUserSearch() {
    const p = sessionStorage.getItem('adminPwd');
    if (!p) return;
    const q = document.getElementById('userSearchQ').value;
    const list = await apiFetch(`${API_BASE}?action=userSearch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPassword: p, q }),
    });
    if (!Array.isArray(list)) return;
    window.__modSearchResults = list;
    const hits = document.getElementById('userSearchHits');
    hits.innerHTML = list.length
      ? list.map((u) => `<button type="button" class="search-hit" data-uid="${escapeHtml(u.userId)}">
        <strong>${escapeHtml(u.nick || '—')}</strong><br><small style="opacity:0.8">${escapeHtml(u.userId)} · ${u.coins} 🪙${u.banned ? ' · блок' : ''}${u.mutedUntil > Date.now() ? ' · мут постов' : ''}</small>
      </button>`).join('')
      : '<p class="hint-bar">Никого не нашли</p>';
    hits.querySelectorAll('.search-hit').forEach((btn) => {
      btn.onclick = () => {
        hits.querySelectorAll('.search-hit').forEach((x) => x.classList.remove('active'));
        btn.classList.add('active');
        const uid = btn.getAttribute('data-uid');
        const row = (window.__modSearchResults || []).find((x) => x.userId === uid);
        if (row) {
          selectedUser = {
            userId: row.userId,
            nick: row.nick,
            coins: row.coins,
            banned: row.banned,
            mutedUntil: row.mutedUntil || 0,
          };
          renderModUserCard(p);
        }
      };
    });
  }

  function renderModUserCard(adminPassword) {
    if (!selectedUser) return;
    const u = selectedUser;
    const card = document.getElementById('modUserCard');
    const inner = document.getElementById('modUserCardInner');
    card.style.display = 'block';
    const mutedActive = (u.mutedUntil || 0) > Date.now();
    const mutedText = mutedActive
      ? `Мут постов до: ${new Date(u.mutedUntil).toLocaleString('ru-RU')}`
      : '';
    inner.innerHTML = `<p><strong>${escapeHtml(u.nick || '—')}</strong></p>
      <p class="hint-bar" style="margin:8px 0;">ID: ${escapeHtml(u.userId)}</p>
      <p>Баланс: ${u.coins} 🪙</p>
      ${mutedText ? `<p class="hint-bar" style="margin-top:6px;">${escapeHtml(mutedText)}</p>` : ''}
      <label class="hint-bar" style="display:block;margin-top:12px;">Комментарий к действию (в журнал, если лист mod_log есть)</label>
      <textarea id="modReason" class="input-modern" rows="2" placeholder="Причина — по желанию" style="width:100%;margin-top:6px;resize:vertical;"></textarea>
      <div class="mod-wallet-grid" style="margin-top:14px;display:grid;gap:10px;">
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
          <input type="number" id="modGiveAmt" class="input-modern" min="1" max="999999" value="100" style="width:100px;" placeholder="Сумма">
          <button type="button" class="btn-primary" id="btnGiveCoins">Выдать 🪙</button>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
          <input type="number" id="modTakeAmt" class="input-modern" min="1" max="999999" value="100" style="width:100px;">
          <button type="button" class="btn-primary btn-secondary" id="btnTakeCoins">Снять 🪙</button>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;align-items:center;">
        ${u.banned
        ? `<button type="button" class="btn-primary btn-secondary" id="btnUnban">Снять блокировку</button>`
        : `<button type="button" class="btn-primary" id="btnBan" style="background:#a33;">Заблокировать посты и комменты</button>`}
      </div>
      <div style="margin-top:14px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
        <select id="modMuteMins" class="input-modern" style="min-width:160px;">
          <option value="60">1 час</option>
          <option value="360">6 часов</option>
          <option value="1440" selected>24 часа</option>
          <option value="4320">3 дня</option>
          <option value="10080">7 дней</option>
          <option value="43200">30 дней</option>
        </select>
        <button type="button" class="btn-primary btn-secondary" id="btnMutePosts">Временно запретить посты</button>
        ${mutedActive ? '<button type="button" class="btn-primary" id="btnUnmutePosts">Снять мут постов</button>' : ''}
      </div>`;
    const reasonVal = () => (document.getElementById('modReason')?.value || '').trim();
    document.getElementById('btnBan')?.addEventListener('click', async () => {
      if (!confirm('Заблокировать пользователя?')) return;
      const r = await apiFetch(`${API_BASE}?action=banUser`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminPassword, userId: u.userId, nick: u.nick, reason: reasonVal(),
        }),
      });
      if (r.error) alert(r.error);
      selectedUser.banned = true;
      runUserSearch();
      renderModUserCard(adminPassword);
    });
    document.getElementById('btnUnban')?.addEventListener('click', async () => {
      await apiFetch(`${API_BASE}?action=unbanUser`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminPassword, userId: u.userId }),
      });
      selectedUser.banned = false;
      runUserSearch();
      renderModUserCard(adminPassword);
    });
    const adj = async (delta) => {
      await apiFetch(`${API_BASE}?action=walletAdjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminPassword, userId: u.userId, nick: u.nick, delta, reason: reasonVal(),
        }),
      });
      runUserSearch();
      const refreshed = await apiFetch(`${API_BASE}?action=userSearch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminPassword, q: u.userId }),
      });
      const row = (refreshed || []).find((x) => x.userId === u.userId);
      if (row) {
        selectedUser.coins = row.coins;
        selectedUser.banned = row.banned;
        selectedUser.mutedUntil = row.mutedUntil || 0;
      }
      renderModUserCard(adminPassword);
    };
    document.getElementById('btnGiveCoins')?.addEventListener('click', () => {
      const n = parseInt(document.getElementById('modGiveAmt')?.value, 10);
      if (!n || n < 1) return alert('Укажите сумму');
      adj(n);
    });
    document.getElementById('btnTakeCoins')?.addEventListener('click', () => {
      const n = parseInt(document.getElementById('modTakeAmt')?.value, 10);
      if (!n || n < 1) return alert('Укажите сумму');
      adj(-n);
    });
    document.getElementById('btnMutePosts')?.addEventListener('click', async () => {
      const mins = parseInt(document.getElementById('modMuteMins')?.value, 10) || 1440;
      const r = await apiFetch(`${API_BASE}?action=mutePosts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminPassword,
          userId: u.userId,
          nick: u.nick,
          durationMinutes: mins,
          reason: reasonVal(),
        }),
      });
      if (r.error) alert(r.error);
      if (r.mutedUntil) selectedUser.mutedUntil = r.mutedUntil;
      runUserSearch();
      renderModUserCard(adminPassword);
    });
    document.getElementById('btnUnmutePosts')?.addEventListener('click', async () => {
      await apiFetch(`${API_BASE}?action=unmutePosts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminPassword, userId: u.userId, reason: reasonVal(),
        }),
      });
      selectedUser.mutedUntil = 0;
      runUserSearch();
      renderModUserCard(adminPassword);
    });
  }

  document.getElementById('userSearchBtn').onclick = runUserSearch;
  document.getElementById('userSearchQ').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runUserSearch();
  });
}

async function loadModQueue(adminPassword) {
  const el = document.getElementById('modQueue');
  if (!el) return;
  const pend = await apiFetch(`${API_BASE}?action=modQueue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminPassword }),
  });
  const list = Array.isArray(pend) ? pend : [];
  const cnt = document.getElementById('modPendingCount');
  if (cnt) cnt.textContent = String(list.length);
  el.innerHTML = list.length
    ? list.map((p) => `<div class="mod-queue-item"><strong>${escapeHtml(p.title || 'Без названия')}</strong>
      <div class="hint-bar" style="margin:6px 0;">${escapeHtml(p.nick)} · ${escapeHtml(p.category || '')}${p.notForStream ? ' · 🔞 не для стрима' : ''}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center;">
        <a class="btn-primary btn-secondary" href="?thread=${encodeURIComponent(p.id)}" target="_blank" rel="noopener" style="text-decoration:none;display:inline-block;padding:8px 14px;border-radius:12px;">Открыть пост</a>
        <button type="button" class="btn-primary" data-ap="${p.id}">Одобрить</button>
        <button type="button" class="btn-primary btn-secondary" data-rj="${p.id}">Отклонить</button>
      </div></div>`).join('')
    : '<p class="hint-bar">Очередь пуста</p>';
  el.querySelectorAll('[data-ap]').forEach((b) => {
    b.onclick = async () => {
      await apiFetch(`${API_BASE}?action=moderate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: b.dataset.ap, status: 'approved', adminPassword }),
      });
      loadModQueue(adminPassword);
    };
  });
  el.querySelectorAll('[data-rj]').forEach((b) => {
    b.onclick = async () => {
      await apiFetch(`${API_BASE}?action=moderate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: b.dataset.rj, status: 'rejected', adminPassword }),
      });
      loadModQueue(adminPassword);
    };
  });
}

function updateSuggestCharCounts() {
  const t = document.getElementById('postTitle');
  const x = document.getElementById('postText');
  const tc = document.getElementById('titleCount');
  const xc = document.getElementById('textCount');
  if (tc && t) tc.textContent = t.value.length;
  if (xc && x) xc.textContent = x.value.length;
}

function openPostModal() {
  if (!currentUser) return loginWithTwitch();
  loadDraft();
  updateSuggestCharCounts();
  document.getElementById('postModal').style.display = 'flex';
}

function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (!d) return;
    if (d.title) document.getElementById('postTitle').value = d.title;
    if (d.text) document.getElementById('postText').value = d.text;
    if (d.game) document.getElementById('postGame').value = d.game;
    if (d.link) document.getElementById('postLink').value = d.link;
    if (d.coAuthors) document.getElementById('postCoAuthors').value = d.coAuthors;
    if (d.category) document.getElementById('postCategory').value = d.category;
  } catch (_) {}
}

function saveDraftDebounced() {
  clearTimeout(window._draftT);
  window._draftT = setTimeout(() => {
    const payload = {
      title: document.getElementById('postTitle').value,
      text: document.getElementById('postText').value,
      game: document.getElementById('postGame').value,
      link: document.getElementById('postLink').value,
      coAuthors: document.getElementById('postCoAuthors')?.value || '',
      category: document.getElementById('postCategory')?.value || '',
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
  }, 400);
}

function closePostModal() {
  document.getElementById('postModal').style.display = 'none';
  ['postTitle', 'postText', 'postGame', 'postLink', 'postMediaLink', 'postCategory'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const co = document.getElementById('postCoAuthors');
  if (co) co.value = '';
  const nfs = document.getElementById('postNotForStream');
  if (nfs) nfs.checked = false;
  pendingMediaDataUrl = '';
  const prev = document.getElementById('suggestPreviewWrap');
  if (prev) {
    prev.classList.remove('visible');
    const im = document.getElementById('suggestPreviewImg');
    if (im) im.removeAttribute('src');
  }
}

function openEditModal(post) {
  editingPostId = post.id;
  document.getElementById('editPostId').value = post.id;
  document.getElementById('editTitle').value = post.title || '';
  document.getElementById('editText').value = post.text || '';
  document.getElementById('editGame').value = post.game || '';
  document.getElementById('editLink').value = post.link || '';
  document.getElementById('editCoAuthors').value = post.coAuthors || '';
  const ec = document.getElementById('editCategory');
  if (ec) ec.value = post.category || '';
  document.getElementById('editModal').style.display = 'flex';
}

function openDeleteModal(postId) {
  document.getElementById('deletePostId').value = postId;
  document.getElementById('deleteModal').style.display = 'flex';
}

async function compressImageToDataUrl(file) {
  const maxBytes = 8 * 1024 * 1024;
  if (file.size > maxBytes) {
    alert('Файл больше 8 МБ');
    return '';
  }
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  let w = bmp.width;
  let h = bmp.height;
  const maxW = 1000;
  if (w > maxW) {
    h = Math.round((h * maxW) / w);
    w = maxW;
  }
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  const maxLen = 48000;
  let q = 0.82;
  let data = canvas.toDataURL('image/jpeg', q);
  while (data.length > maxLen && q > 0.35) {
    q -= 0.07;
    data = canvas.toDataURL('image/jpeg', q);
  }
  if (data.length > maxLen) {
    alert('Фото слишком большое — вставьте ссылку на картинку.');
    return '';
  }
  return data;
}

function initSuggestModal() {
  const zone = document.getElementById('suggestDropZone');
  const input = document.getElementById('suggestFileInput');
  if (!zone || !input) return;
  zone.addEventListener('click', () => input.click());
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('dragover'); }));
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const f = e.dataTransfer.files?.[0];
    if (!f?.type.startsWith('image/')) return alert('Нужно изображение');
    pendingMediaDataUrl = await compressImageToDataUrl(f);
    if (pendingMediaDataUrl) {
      document.getElementById('postMediaLink').value = '';
      const w = document.getElementById('suggestPreviewWrap');
      const im = document.getElementById('suggestPreviewImg');
      im.src = pendingMediaDataUrl;
      w.classList.add('visible');
    }
  });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    pendingMediaDataUrl = await compressImageToDataUrl(f);
    if (pendingMediaDataUrl) {
      document.getElementById('postMediaLink').value = '';
      document.getElementById('suggestPreviewImg').src = pendingMediaDataUrl;
      document.getElementById('suggestPreviewWrap').classList.add('visible');
    }
    input.value = '';
  });
  document.getElementById('suggestRemoveMedia')?.addEventListener('click', () => {
    pendingMediaDataUrl = '';
    document.getElementById('suggestPreviewWrap').classList.remove('visible');
  });
  document.getElementById('postCategory')?.addEventListener('input', () => {
    updateSuggestCharCounts();
    saveDraftDebounced();
  });
  ['postTitle', 'postText', 'postGame', 'postLink'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      if (id === 'postTitle' || id === 'postText') updateSuggestCharCounts();
      saveDraftDebounced();
    });
  });
  document.getElementById('postCoAuthors')?.addEventListener('input', saveDraftDebounced);
}

function initShell() {
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      const p = item.dataset.page;
      setRoute(p, '');
    });
  });
  window.addEventListener('popstate', route);
  document.getElementById('scrollTopBtn')?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  window.addEventListener('scroll', () => {
    document.getElementById('scrollTopBtn')?.classList.toggle('visible', window.scrollY > 420);
  });
  document.getElementById('mainContent')?.addEventListener('click', (e) => {
    const m = e.target.closest('.comment-more');
    if (!m) return;
    const hidden = m.previousElementSibling;
    const bubble = m.closest('.comment-bubble');
    const tx = bubble?.querySelector('.comment-text');
    if (hidden?.classList.contains('comment-long-full') && tx) {
      tx.innerHTML = formatCommentHtml(hidden.textContent);
      hidden.remove();
      m.remove();
    }
  });
  window.addEventListener('online', () => {
    const t = document.getElementById('netToast');
    if (t) {
      t.textContent = 'Связь восстановлена';
      t.classList.add('visible');
      setTimeout(() => t.classList.remove('visible'), 2500);
    }
  });
  window.addEventListener('offline', () => {
    const t = document.getElementById('netToast');
    if (t) {
      t.textContent = 'Нет интернета';
      t.classList.add('visible');
    }
  });
  document.getElementById('submitPostBtn')?.addEventListener('click', submitNewPost);
  document.getElementById('closeModalBtn')?.addEventListener('click', closePostModal);
  document.getElementById('saveEditBtn')?.addEventListener('click', saveEditPost);
  document.getElementById('closeEditBtn')?.addEventListener('click', () => { document.getElementById('editModal').style.display = 'none'; });
  document.getElementById('confirmDeleteBtn')?.addEventListener('click', confirmDeletePost);
  document.getElementById('cancelDeleteBtn')?.addEventListener('click', () => { document.getElementById('deleteModal').style.display = 'none'; });
  initSuggestModal();
}

async function submitNewPost() {
  const title = document.getElementById('postTitle').value.trim();
  const text = document.getElementById('postText').value.trim();
  if (!text) return alert('Описание обязательно');
  let mediaUrl = pendingMediaDataUrl || '';
  const ml = document.getElementById('postMediaLink').value.trim();
  if (ml) {
    const s = safeMediaUrl(ml);
    if (!s) return alert('Некорректная ссылка на картинку');
    mediaUrl = s;
  }
  const cat = (document.getElementById('postCategory').value || '').trim() || 'Другое';
  const postData = {
    title,
    text,
    category: cat.slice(0, 40),
    game: document.getElementById('postGame').value.trim(),
    link: document.getElementById('postLink').value.trim(),
    coAuthors: document.getElementById('postCoAuthors')?.value.trim() || '',
    nick: currentUser.display_name,
    avatar: currentUser.profile_image_url,
    userId: currentUser.id,
    mediaUrl,
    notForStream: document.getElementById('postNotForStream').checked,
  };
  let res;
  try {
    res = await apiFetch(`${API_BASE}?action=create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(postData),
    });
  } catch {
    return alert('Ошибка сети');
  }
  if (res.error) return alert(res.error);
  localStorage.removeItem(DRAFT_KEY);
  closePostModal();
  setRoute('feed', res.id);
}

async function saveEditPost() {
  const postId = document.getElementById('editPostId').value;
  const body = {
    postId,
    userId: currentUser.id,
    title: document.getElementById('editTitle').value,
    text: document.getElementById('editText').value,
    category: (document.getElementById('editCategory')?.value || '').trim().slice(0, 40) || 'Другое',
    game: document.getElementById('editGame').value,
    link: document.getElementById('editLink').value,
    coAuthors: document.getElementById('editCoAuthors').value,
  };
  const res = await apiFetch(`${API_BASE}?action=updatePost`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.error) return alert(res.error);
  document.getElementById('editModal').style.display = 'none';
  route();
}

async function confirmDeletePost() {
  const postId = document.getElementById('deletePostId').value;
  const res = await apiFetch(`${API_BASE}?action=deletePost`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postId, userId: currentUser.id }),
  });
  if (res.error) return alert(res.error);
  document.getElementById('deleteModal').style.display = 'none';
  setRoute('feed', '');
}

applySettings();
loadUserFromStorage();
checkTwitchAuth();
initShell();
showLoader();
setTimeout(() => {
  route();
  hideLoader();
}, settings.animations ? 380 : 0);

window.loginWithTwitch = loginWithTwitch;
window.logout = logout;
window.setRoute = setRoute;
