import { google } from 'googleapis';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const { nick, title, category, link, comment } = req.body;

    const now = new Date().toLocaleString('ru-RU');
    const suggestionId = Date.now().toString();

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SHEET_ID,
      range: 'Лист1!A:H',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          now,
          nick,
          title,
          category,
          link || '-',
          comment || '-',
          '0',
          suggestionId
        ]]
      }
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({ success: true, id: suggestionId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}