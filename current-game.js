export default async function handler(req, res) {
    try {
        const response = await fetch(
            `https://api.twitch.tv/helix/streams?user_login=honesty113`,
            {
                headers: {
                    'Client-ID': process.env.TWITCH_CLIENT_ID,
                    'Authorization': `Bearer ${process.env.TWITCH_ACCESS_TOKEN}`
                }
            }
        );
        const data = await response.json();
        
        if (data.data && data.data[0]) {
            res.status(200).json({ 
                gameId: data.data[0].game_id,
                gameName: data.data[0].game_name
            });
        } else {
            res.status(200).json({ gameId: null });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}