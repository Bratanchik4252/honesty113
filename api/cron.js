import { google } from 'googleapis';

export default async function handler(req, res) {
  // Проверяем секретный ключ (для безопасности)
  if (req.query.secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Получаем VOD с Twitch API
    const twitchResponse = await fetch(
      'https://api.twitch.tv/helix/videos?user_id=718517321&first=10&type=archive',
      {
        headers: {
          'Client-ID': process.env.TWITCH_CLIENT_ID,
          'Authorization': `Bearer ${process.env.TWITCH_ACCESS_TOKEN}`
        }
      }
    );
    const twitchData = await twitchResponse.json();
    
    if (!twitchData.data) {
      return res.status(500).json({ error: 'No VOD data' });
    }

    // Подключаемся к Google Sheets
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Получаем существующие VOD
    const existingResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: 'vods!A:A',
    });

    const existingDates = existingResponse.data.values?.map(row => row[0]) || [];
    let added = 0;

    // Добавляем новые
    for (const vod of twitchData.data) {
      const vodDate = new Date(vod.created_at).toLocaleDateString('ru-RU');
      
      if (!existingDates.includes(vodDate)) {
        await sheets.spreadsheets.values.append({
          spreadsheetId: process.env.SHEET_ID,
          range: 'vods!A:C',
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [[
              vodDate,
              `https://twitch.tv/videos/${vod.id}`,
              vod.title
            ]]
          }
        });
        added++;
      }
    }

    res.status(200).json({ success: true, added });
  } catch (error) {
    console.error('Cron error:', error);
    res.status(500).json({ error: error.message });
  }
}
