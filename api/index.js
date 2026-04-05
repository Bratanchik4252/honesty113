import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

function adminOk(pwd) {
  const a = process.env.ADMIN_PASSWORD;
  return a && pwd === a;
}

function parseBool(v) {
  return v === '1' || String(v).toUpperCase() === 'TRUE';
}

function rowToPost(row) {
  return {
    id: row[0],
    date: row[1],
    authorId: row[2],
    nick: row[3],
    avatar: row[4],
    title: row[5],
    text: row[6],
    category: row[7],
    game: row[8],
    link: row[9],
    rating: parseInt(row[10], 10) || 0,
    mediaUrl: row[11] || '',
    notForStream: parseBool(row[12]),
    views: parseInt(row[13], 10) || 0,
    status: (row[14] || '').trim() || 'approved',
    coAuthors: row[15] || '',
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { action } = req.query;

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
      scopes: SCOPES,
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetId = process.env.SHEET_ID;
    const modRequired = process.env.REQUIRE_MOD_APPROVAL === 'true';
    const streamLogin = (process.env.TWITCH_STREAM_LOGIN || 'honesty113').toLowerCase();

    async function getPostRows() {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: 'posts!A:P',
      });
      return response.data.values || [];
    }

    async function getBannedUserIds() {
      try {
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: sheetId,
          range: 'banned!A:A',
        });
        const rows = response.data.values || [];
        return new Set(rows.slice(1).map((r) => r[0]).filter(Boolean));
      } catch {
        return new Set();
      }
    }

    async function getBannedSheetId() {
      const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
      const sh = meta.data.sheets.find((s) => s.properties.title === 'banned');
      return sh ? sh.properties.sheetId : null;
    }

    async function getPostMuteSheetId() {
      const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
      const sh = meta.data.sheets.find((s) => s.properties.title === 'post_mutes');
      return sh ? sh.properties.sheetId : null;
    }

    /** @returns {Promise<Map<string, number>>} userId -> until (epoch ms) */
    async function getPostMuteUntilMap() {
      try {
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: sheetId,
          range: 'post_mutes!A:B',
        });
        const rows = response.data.values || [];
        const now = Date.now();
        const map = new Map();
        for (let i = 1; i < rows.length; i++) {
          const uid = rows[i][0];
          const until = parseInt(rows[i][1], 10);
          if (uid && !Number.isNaN(until) && until > now) map.set(uid, until);
        }
        return map;
      } catch {
        return new Map();
      }
    }

    async function tryModLog(action, userId, nick, detail, reason) {
      const r = typeof reason === 'string' ? reason.slice(0, 300) : '';
      try {
        await sheets.spreadsheets.values.append({
          spreadsheetId: sheetId,
          range: 'mod_log!A:F',
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [[new Date().toISOString(), action, userId || '', nick || '', detail || '', r]],
          },
        });
      } catch {
        /* лист mod_log необязателен */
      }
    }

    if (action === 'posts') {
      const rows = await getPostRows();
      const viewerId = req.query.viewerId || '';
      const isAdmin = adminOk(req.query.adminPass || '');
      const posts = rows.slice(1).map(rowToPost).filter((p) => {
        if (p.status === 'rejected') return isAdmin;
        if (p.status === 'pending') return p.authorId === viewerId || isAdmin;
        return true;
      });
      return res.status(200).json(posts);
    }

    if (action === 'stream' && req.method === 'GET') {
      const cid = process.env.TWITCH_CLIENT_ID;
      const token = process.env.TWITCH_ACCESS_TOKEN;
      if (!cid || !token) {
        return res.status(200).json({ live: false, title: null, game: null, viewerCount: 0 });
      }
      const r = await fetch(
        `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(streamLogin)}`,
        { headers: { 'Client-ID': cid, Authorization: `Bearer ${token}` } }
      );
      const j = await r.json();
      const s = j.data && j.data[0];
      if (!s) {
        return res.status(200).json({ live: false, title: null, game: null, viewerCount: 0 });
      }
      return res.status(200).json({
        live: true,
        title: s.title,
        game: s.game_name,
        viewerCount: s.viewer_count,
      });
    }

    if (action === 'view' && req.method === 'POST') {
      const { postId } = req.body || {};
      if (!postId) return res.status(400).json({ error: 'postId required' });
      const rows = await getPostRows();
      let rowIndex = -1;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === postId) {
          rowIndex = i + 1;
          break;
        }
      }
      if (rowIndex === -1) return res.status(404).json({ error: 'Not found' });
      const views = (parseInt(rows[rowIndex - 1][13], 10) || 0) + 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `posts!N${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[String(views)]] },
      });
      return res.status(200).json({ success: true, views });
    }

    if (action === 'create' && req.method === 'POST') {
      const body = req.body || {};
      const {
        title, text, category, game, link, nick, avatar, userId,
        mediaUrl, notForStream, coAuthors,
      } = body;
      if (!userId) return res.status(400).json({ error: 'Нужен вход через Twitch' });
      const media = typeof mediaUrl === 'string' ? mediaUrl.trim() : '';
      if (media.length > 50000) {
        return res.status(400).json({ error: 'Вложение слишком большое' });
      }

      const rows = await getPostRows();
      const nowTs = Date.now();
      const lastSame = rows.slice(1).filter((r) => r[2] === userId);
      const lastId = lastSame.map((r) => Number(r[0])).filter(Boolean).sort((a, b) => b - a)[0];
      if (lastId && nowTs - lastId < 3600000) {
        return res.status(429).json({ error: 'Не больше одной предложки в час' });
      }

      const bannedIds = await getBannedUserIds();
      if (bannedIds.has(userId)) {
        return res.status(403).json({ error: 'Публикация постов для этого аккаунта ограничена' });
      }
      const muteUntil = await getPostMuteUntilMap();
      if (muteUntil.has(userId)) {
        return res.status(403).json({ error: 'Публикация постов временно ограничена' });
      }

      const catNorm =
        typeof category === 'string' ? category.trim().slice(0, 40) || 'Другое' : 'Другое';
      const newId = String(nowTs);
      const now = new Date().toLocaleString('ru-RU');
      const nfs = notForStream ? '1' : '0';
      const status = modRequired || notForStream ? 'pending' : 'approved';
      const row = [
        newId, now, userId, nick, avatar, title || text, text, catNorm,
        game || '', link || '', '0', media, nfs, '0', status,
        typeof coAuthors === 'string' ? coAuthors.slice(0, 200) : '',
      ];
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: 'posts!A:P',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] },
      });
      return res.status(200).json({ success: true, id: newId, status });
    }

    if (action === 'updatePost' && req.method === 'POST') {
      const { postId, userId, adminPassword, title, text, category, game, link, mediaUrl, notForStream, coAuthors } = req.body || {};
      if (!postId) return res.status(400).json({ error: 'postId required' });
      const rows = await getPostRows();
      let rowIndex = -1;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === postId) {
          rowIndex = i;
          break;
        }
      }
      if (rowIndex === -1) return res.status(404).json({ error: 'Not found' });
      const row = rows[rowIndex];
      const author = row[2];
      if (author !== userId && !adminOk(adminPassword)) {
        return res.status(403).json({ error: 'Нет прав' });
      }
      const media = typeof mediaUrl === 'string' ? mediaUrl.trim() : (row[11] || '');
      if (media.length > 50000) return res.status(400).json({ error: 'Медиа слишком большое' });
      const catCell =
        category != null
          ? typeof category === 'string'
            ? category.trim().slice(0, 40) || 'Другое'
            : row[7]
          : row[7];
      const nfsNew = notForStream != null ? !!notForStream : parseBool(row[12]);
      let statusCell = ((row[14] || '').trim() || 'approved');
      if (author === userId && !adminOk(adminPassword) && nfsNew) {
        statusCell = 'pending';
      }
      const updated = [
        row[0], row[1], row[2], row[3], row[4],
        title != null ? title : row[5],
        text != null ? text : row[6],
        catCell,
        game != null ? game : row[8],
        link != null ? link : row[9],
        row[10],
        media,
        notForStream != null ? (notForStream ? '1' : '0') : row[12],
        row[13] || '0',
        statusCell,
        coAuthors != null ? String(coAuthors).slice(0, 200) : (row[15] || ''),
      ];
      const line = rowIndex + 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `posts!A${line}:P${line}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [updated] },
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'deletePost' && req.method === 'POST') {
      const { postId, userId, adminPassword } = req.body || {};
      if (!postId) return res.status(400).json({ error: 'postId required' });
      const rows = await getPostRows();
      let rowIndex = -1;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === postId) {
          rowIndex = i;
          break;
        }
      }
      if (rowIndex === -1) return res.status(404).json({ error: 'Not found' });
      const author = rows[rowIndex][2];
      if (author !== userId && !adminOk(adminPassword)) {
        return res.status(403).json({ error: 'Нет прав' });
      }
      const line = rowIndex + 1;
      const r = rows[rowIndex];
      r[14] = 'rejected';
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `posts!O${line}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['rejected']] },
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'moderate' && req.method === 'POST') {
      const { postId, status, adminPassword } = req.body || {};
      if (!adminOk(adminPassword)) return res.status(403).json({ error: 'Неверный пароль' });
      if (!['approved', 'pending', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'status' });
      }
      const rows = await getPostRows();
      let line = -1;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === postId) {
          line = i + 1;
          break;
        }
      }
      if (line === -1) return res.status(404).json({ error: 'Not found' });
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `posts!O${line}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[status]] },
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'comments') {
      const { postId } = req.query;
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: 'comments!A:J',
      });
      const rows = response.data.values || [];
      const comments = rows.slice(1)
        .filter((row) => row[0] === postId)
        .map((row) => {
          const replyMeta = row[9] || '';
          const parts = replyMeta.split('¶');
          return {
            id: row[1],
            date: row[2],
            userId: row[3],
            nick: row[4],
            avatar: row[5],
            text: row[6],
            likes: parseInt(row[7], 10) || 0,
            dislikes: parseInt(row[8], 10) || 0,
            replyToNick: parts[0] || '',
            replyExcerpt: parts[1] || '',
          };
        });
      return res.status(200).json(comments);
    }

    if (action === 'addComment' && req.method === 'POST') {
      const { postId, text, userId, nick, avatar, replyMeta } = req.body || {};
      if (userId) {
        const bannedIds = await getBannedUserIds();
        if (bannedIds.has(userId)) {
          return res.status(403).json({ error: 'Комментарии для этого аккаунта ограничены' });
        }
      }
      const now = new Date().toLocaleString('ru-RU');
      const commentId = String(Date.now());
      const meta = typeof replyMeta === 'string' ? replyMeta.slice(0, 300) : '';
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: 'comments!A:J',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[postId, commentId, now, userId, nick, avatar, text, '0', '0', meta]] },
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'vote' && req.method === 'POST') {
      const { postId, type } = req.body || {};
      const rows = await getPostRows();
      let rowIndex = -1;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === postId) {
          rowIndex = i + 1;
          break;
        }
      }
      if (rowIndex === -1) return res.status(404).json({ error: 'Post not found' });
      const currentRating = parseInt(rows[rowIndex - 1][10], 10) || 0;
      const newRating = type === 'up' ? currentRating + 1 : currentRating - 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `posts!K${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[String(newRating)]] },
      });
      return res.status(200).json({ success: true, newRating });
    }

    if (action === 'wallet' && req.method === 'GET') {
      const uid = req.query.userId;
      if (!uid) return res.status(400).json({ error: 'userId' });
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: 'wallet!A:C',
      });
      const rows = response.data.values || [];
      const row = rows.slice(1).find((r) => r[0] === uid);
      const coins = row ? parseInt(row[2], 10) || 0 : 0;
      return res.status(200).json({ userId: uid, coins });
    }

    if (action === 'walletSearch' && req.method === 'POST') {
      const { adminPassword, q } = req.body || {};
      if (!adminOk(adminPassword)) return res.status(403).json({ error: 'Неверный пароль' });
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: 'wallet!A:C',
      });
      const rows = response.data.values || [];
      const needle = (q || '').toLowerCase();
      const list = rows.slice(1)
        .filter((r) => !needle || (r[1] && r[1].toLowerCase().includes(needle)))
        .map((r) => ({ userId: r[0], nick: r[1], coins: parseInt(r[2], 10) || 0 }))
        .slice(0, 50);
      return res.status(200).json(list);
    }

    if (action === 'walletAdjust' && req.method === 'POST') {
      const { adminPassword, userId, nick, delta, reason } = req.body || {};
      if (!adminOk(adminPassword)) return res.status(403).json({ error: 'Неверный пароль' });
      if (!userId) return res.status(400).json({ error: 'userId' });
      const d = parseInt(delta, 10);
      if (Number.isNaN(d) || d === 0) return res.status(400).json({ error: 'delta' });
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: 'wallet!A:C',
      });
      const rows = response.data.values || [];
      let idx = -1;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === userId) {
          idx = i;
          break;
        }
      }
      const newCoins = Math.max(0, (idx >= 0 ? parseInt(rows[idx][2], 10) || 0 : 0) + d);
      const displayNick = nick || (idx >= 0 ? rows[idx][1] : '');
      if (idx === -1) {
        await sheets.spreadsheets.values.append({
          spreadsheetId: sheetId,
          range: 'wallet!A:C',
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[userId, displayNick || '?', String(newCoins)]] },
        });
      } else {
        const line = idx + 1;
        await sheets.spreadsheets.values.update({
          spreadsheetId: sheetId,
          range: `wallet!B${line}:C${line}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[displayNick || rows[idx][1], String(newCoins)]] },
        });
      }
      await tryModLog(d > 0 ? 'wallet+' : 'wallet-', userId, displayNick, String(d), reason);
      return res.status(200).json({ success: true, coins: newCoins });
    }

    if (action === 'boost' && req.method === 'POST') {
      const { postId, userId, amount } = req.body || {};
      if (!postId || !userId) return res.status(400).json({ error: 'postId, userId' });
      const amt = parseInt(amount, 10);
      if (!Number.isFinite(amt) || amt < 1 || amt > 1000) {
        return res.status(400).json({ error: 'Укажите сумму от 1 до 1000 монет' });
      }
      const wRes = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: 'wallet!A:C',
      });
      const wRows = wRes.data.values || [];
      let wIdx = -1;
      for (let i = 1; i < wRows.length; i++) {
        if (wRows[i][0] === userId) {
          wIdx = i;
          break;
        }
      }
      const coins = wIdx >= 0 ? parseInt(wRows[wIdx][2], 10) || 0 : 0;
      if (coins < amt) return res.status(400).json({ error: 'Недостаточно монет' });

      const pRows = await getPostRows();
      let pLine = -1;
      for (let i = 1; i < pRows.length; i++) {
        if (pRows[i][0] === postId) {
          pLine = i + 1;
          break;
        }
      }
      if (pLine === -1) return res.status(404).json({ error: 'Пост не найден' });

      const newCoins = coins - amt;
      const rating = (parseInt(pRows[pLine - 1][10], 10) || 0) + amt;
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `wallet!C${wIdx + 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[String(newCoins)]] },
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `posts!K${pLine}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[String(rating)]] },
      });
      return res.status(200).json({ success: true, coins: newCoins, newRating: rating });
    }

    if (action === 'vods') {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: 'vods!A:C',
      });
      const rows = response.data.values || [];
      const vods = rows.slice(1).map((row) => ({ date: row[0], url: row[1], title: row[2] }));
      return res.status(200).json(vods);
    }

    if (action === 'adminPing' && req.method === 'POST') {
      const { adminPassword } = req.body || {};
      return res.status(200).json({ ok: adminOk(adminPassword) });
    }

    if (action === 'modQueue' && req.method === 'POST') {
      const { adminPassword } = req.body || {};
      if (!adminOk(adminPassword)) return res.status(403).json({ error: 'Нет доступа' });
      const rows = await getPostRows();
      const pend = rows.slice(1)
        .filter((r) => ((r[14] || '').trim() || 'approved') === 'pending')
        .map(rowToPost);
      return res.status(200).json(pend);
    }

    if (action === 'userSearch' && req.method === 'POST') {
      const { adminPassword, q } = req.body || {};
      if (!adminOk(adminPassword)) return res.status(403).json({ error: 'Нет доступа' });
      const needle = (q || '').toLowerCase().trim();
      const rows = await getPostRows();
      const userMap = new Map();
      for (let i = 1; i < rows.length; i++) {
        const uid = rows[i][2];
        const nk = rows[i][3] || '';
        if (!uid) continue;
        if (!userMap.has(uid)) userMap.set(uid, { userId: uid, nick: nk, coins: 0 });
        else if (nk) userMap.get(uid).nick = nk;
      }
      let wRows = [];
      try {
        const wRes = await sheets.spreadsheets.values.get({
          spreadsheetId: sheetId,
          range: 'wallet!A:C',
        });
        wRows = wRes.data.values || [];
      } catch {
        wRows = [];
      }
      for (let i = 1; i < wRows.length; i++) {
        const uid = wRows[i][0];
        const nk = wRows[i][1] || '';
        const c = parseInt(wRows[i][2], 10) || 0;
        if (!uid) continue;
        if (!userMap.has(uid)) {
          userMap.set(uid, { userId: uid, nick: nk, coins: c });
        } else {
          const u = userMap.get(uid);
          u.coins = c;
          if (nk) u.nick = nk;
        }
      }
      const bannedSet = await getBannedUserIds();
      const muteMap = await getPostMuteUntilMap();
      let list = [...userMap.values()].map((u) => ({
        userId: u.userId,
        nick: u.nick,
        coins: u.coins,
        banned: bannedSet.has(u.userId),
        mutedUntil: muteMap.get(u.userId) || 0,
      }));
      if (needle) {
        list = list.filter((u) => u.userId.toLowerCase().includes(needle)
          || (u.nick && u.nick.toLowerCase().includes(needle)));
      }
      list.sort((a, b) => (a.nick || a.userId).localeCompare(b.nick || b.userId, 'ru'));
      return res.status(200).json(list.slice(0, 100));
    }

    if (action === 'banUser' && req.method === 'POST') {
      const { adminPassword, userId, nick, reason } = req.body || {};
      if (!adminOk(adminPassword)) return res.status(403).json({ error: 'Нет доступа' });
      if (!userId) return res.status(400).json({ error: 'userId' });
      const bannedSet = await getBannedUserIds();
      if (bannedSet.has(userId)) return res.status(200).json({ success: true, already: true });
      const nk = typeof nick === 'string' ? nick.slice(0, 80) : '';
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: 'banned!A:B',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[userId, nk]] },
      });
      await tryModLog('ban', userId, nk, '', reason);
      return res.status(200).json({ success: true });
    }

    if (action === 'unbanUser' && req.method === 'POST') {
      const { adminPassword, userId } = req.body || {};
      if (!adminOk(adminPassword)) return res.status(403).json({ error: 'Нет доступа' });
      if (!userId) return res.status(400).json({ error: 'userId' });
      const bRes = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: 'banned!A:A',
      });
      const bRows = bRes.data.values || [];
      let delIdx = -1;
      for (let i = 1; i < bRows.length; i++) {
        if (bRows[i][0] === userId) {
          delIdx = i;
          break;
        }
      }
      if (delIdx === -1) return res.status(200).json({ success: true, missing: true });
      const sid = await getBannedSheetId();
      if (sid == null) return res.status(500).json({ error: 'Лист banned не найден' });
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId: sid,
                dimension: 'ROWS',
                startIndex: delIdx,
                endIndex: delIdx + 1,
              },
            },
          }],
        },
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'mutePosts' && req.method === 'POST') {
      const { adminPassword, userId, nick, durationMinutes, reason } = req.body || {};
      if (!adminOk(adminPassword)) return res.status(403).json({ error: 'Нет доступа' });
      if (!userId) return res.status(400).json({ error: 'userId' });
      let mins = parseInt(durationMinutes, 10);
      if (Number.isNaN(mins)) mins = 60;
      mins = Math.min(Math.max(mins, 1), 43200);
      const addMs = mins * 60 * 1000;
      const nk = typeof nick === 'string' ? nick.slice(0, 80) : '';
      let rows = [];
      try {
        const r = await sheets.spreadsheets.values.get({
          spreadsheetId: sheetId,
          range: 'post_mutes!A:C',
        });
        rows = r.data.values || [];
      } catch {
        return res.status(500).json({ error: 'Добавьте лист post_mutes (колонки: userId, until, reason)' });
      }
      let line = -1;
      let existingUntil = 0;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === userId) {
          line = i + 1;
          existingUntil = parseInt(rows[i][1], 10) || 0;
          break;
        }
      }
      const base = Math.max(Date.now(), existingUntil);
      const newUntil = base + addMs;
      const rs = typeof reason === 'string' ? reason.slice(0, 200) : '';
      if (line === -1) {
        await sheets.spreadsheets.values.append({
          spreadsheetId: sheetId,
          range: 'post_mutes!A:C',
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[userId, String(newUntil), rs]] },
        });
      } else {
        await sheets.spreadsheets.values.update({
          spreadsheetId: sheetId,
          range: `post_mutes!B${line}:C${line}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[String(newUntil), rs]] },
        });
      }
      await tryModLog('mute_posts', userId, nk, `${mins}m`, reason);
      return res.status(200).json({ success: true, mutedUntil: newUntil });
    }

    if (action === 'unmutePosts' && req.method === 'POST') {
      const { adminPassword, userId, reason } = req.body || {};
      if (!adminOk(adminPassword)) return res.status(403).json({ error: 'Нет доступа' });
      if (!userId) return res.status(400).json({ error: 'userId' });
      let rows = [];
      try {
        const r = await sheets.spreadsheets.values.get({
          spreadsheetId: sheetId,
          range: 'post_mutes!A:A',
        });
        rows = r.data.values || [];
      } catch {
        return res.status(200).json({ success: true, missing: true });
      }
      let delIdx = -1;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === userId) {
          delIdx = i;
          break;
        }
      }
      if (delIdx === -1) return res.status(200).json({ success: true, missing: true });
      const sid = await getPostMuteSheetId();
      if (sid == null) return res.status(500).json({ error: 'Лист post_mutes не найден' });
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId: sid,
                dimension: 'ROWS',
                startIndex: delIdx,
                endIndex: delIdx + 1,
              },
            },
          }],
        },
      });
      await tryModLog('unmute_posts', userId, '', '', reason);
      return res.status(200).json({ success: true });
    }

    if (action === 'userStats' && req.method === 'GET') {
      const uid = req.query.userId;
      if (!uid) return res.status(400).json({ error: 'userId' });
      let written = 0;
      try {
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: sheetId,
          range: 'comments!A:J',
        });
        const rows = response.data.values || [];
        for (let i = 1; i < rows.length; i++) {
          if (rows[i][3] === uid) written += 1;
        }
      } catch {
        written = 0;
      }
      return res.status(200).json({ writtenComments: written });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (error) {
    console.error('API error:', error);
    return res.status(500).json({ error: error.message });
  }
}
