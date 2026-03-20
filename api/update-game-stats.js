import { google } from 'googleapis';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    
    // Получаем текущие игры
    const gamesResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: 'games!A:F',
    });
    
    const gamesRows = gamesResponse.data.values || [];
    
    // Здесь можно добавить логику обновления времени игр из Twitch API
    // Для простоты пока возвращаем успех
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Update game stats error:', error);
    res.status(500).json({ error: error.message });
  }
}
