import { google } from 'googleapis';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { action } = req.query;

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // === ПОЛУЧИТЬ ПОСТЫ ===
    if (action === 'posts') {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SHEET_ID,
        range: 'posts!A:J',
      });
      const rows = response.data.values || [];
      const posts = rows.slice(1).map(row => ({
        id: row[0], date: row[1], authorId: row[2], nick: row[3],
        avatar: row[4], title: row[5], text: row[5], category: row[6],
        game: row[7], link: row[8], rating: parseInt(row[9]) || 0
      }));
      return res.status(200).json(posts);
    }

    // === СОЗДАТЬ ПОСТ ===
    if (action === 'create' && req.method === 'POST') {
      const { title, text, category, game, link, nick, avatar, userId } = req.body;
      const newId = Date.now().toString();
      const now = new Date().toLocaleString('ru-RU');
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.SHEET_ID,
        range: 'posts!A:J',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[newId, now, userId || '', nick, avatar, title || text, category, game || '', link || '', '0']] }
      });
      return res.status(200).json({ success: true, id: newId });
    }

    // === КОММЕНТАРИИ ===
    if (action === 'comments') {
      const { postId } = req.query;
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SHEET_ID,
        range: 'comments!A:H',
      });
      const rows = response.data.values || [];
      const comments = rows.slice(1)
        .filter(row => row[0] === postId)
        .map(row => ({ id: row[1], date: row[2], nick: row[4], avatar: row[5], text: row[6], likes: parseInt(row[7]) || 0, dislikes: parseInt(row[8]) || 0 }));
      return res.status(200).json(comments);
    }

    if (action === 'addComment' && req.method === 'POST') {
      const { postId, text, userId, nick, avatar } = req.body;
      const now = new Date().toLocaleString('ru-RU');
      const commentId = Date.now().toString();
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.SHEET_ID,
        range: 'comments!A:H',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[postId, commentId, now, userId, nick, avatar, text, '0', '0']] }
      });
      return res.status(200).json({ success: true });
    }

    // === ГОЛОСОВАНИЕ ===
    if (action === 'vote' && req.method === 'POST') {
      const { postId, type, userId } = req.body;
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SHEET_ID,
        range: 'posts!A:J',
      });
      const rows = response.data.values || [];
      let rowIndex = -1;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === postId) { rowIndex = i + 1; break; }
      }
      if (rowIndex === -1) return res.status(404).json({ error: 'Post not found' });
      const currentRating = parseInt(rows[rowIndex - 1][9]) || 0;
      const newRating = type === 'up' ? currentRating + 1 : currentRating - 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId: process.env.SHEET_ID,
        range: `posts!J${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[newRating]] }
      });
      return res.status(200).json({ success: true, newRating });
    }

    // === VOD (КАЛЕНДАРЬ) ===
    if (action === 'vods') {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SHEET_ID,
        range: 'vods!A:C',
      });
      const rows = response.data.values || [];
      const vods = rows.slice(1).map(row => ({ date: row[0], url: row[1], title: row[2] }));
      return res.status(200).json(vods);
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
