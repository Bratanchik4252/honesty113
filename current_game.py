import os
import json
import requests

def handler(request):
    try:
        # Получаем данные с Twitch API
        client_id = os.environ.get('TWITCH_CLIENT_ID')
        access_token = os.environ.get('TWITCH_ACCESS_TOKEN')
        
        headers = {
            'Client-ID': client_id,
            'Authorization': f'Bearer {access_token}'
        }
        
        response = requests.get(
            'https://api.twitch.tv/helix/streams?user_login=honesty113',
            headers=headers
        )
        
        data = response.json()
        
        if data.get('data') and len(data['data']) > 0:
            game_name = data['data'][0].get('game_name')
            game_id = data['data'][0].get('game_id')
            
            return {
                'statusCode': 200,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                'body': json.dumps({
                    'game_name': game_name,
                    'game_id': game_id,
                    'is_live': True
                })
            }
        else:
            return {
                'statusCode': 200,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                'body': json.dumps({
                    'is_live': False
                })
            }
            
    except Exception as e:
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({'error': str(e)})
        }