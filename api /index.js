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
        avatar: row[4], text: row[5], category: row[6], game: row[7],
        link: row[8], rating: parseInt(row[9]) || 0
      }));
      return res.status(200).json(posts);
    }

    // === ДОБАВИТЬ ПОСТ ===
    if (action === 'create' && req.method === 'POST') {
      const { nick, avatar, text, category, game, link } = req.body;
      const newId = Date.now().toString();
      const newRow = [newId, new Date().toISOString(), '', nick, avatar, text, category, game, link, 0];
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.SHEET_ID,
        range: 'posts!A:J',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [newRow] }
      });
      return res.status(200).json({ success: true, id: newId });
    }

    // === ОСТАЛЬНЫЕ ДЕЙСТВИЯ (комменты, голоса, календарь, статистика) ===
    // будут добавляться по мере необходимости

    return res.status(400).json({ error: 'Unknown action' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
