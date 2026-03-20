import { google } from 'googleapis';

export default async function handler(req, res) {
  if (req.query.secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Получаем существующие VOD
    const existingResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: 'vods!A:C',
    });

    const rows = existingResponse.data.values || [];
    const today = new Date().toLocaleDateString('ru-RU');
    let added = 0;

    // Если таблица пустая — создаем первую запись
    if (rows.length <= 1) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.SHEET_ID,
        range: 'vods!A:C',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[
            today,
            `https://twitch.tv/honesty113`,
            `Стрим ${today}`
          ]]
        }
      });
      added++;
    } else {
      // Проверяем, есть ли запись на сегодня
      const lastRow = rows[rows.length - 1];
      const lastDate = lastRow[0];
      
      if (lastDate !== today) {
        await sheets.spreadsheets.values.append({
          spreadsheetId: process.env
