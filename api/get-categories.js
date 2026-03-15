export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const categories = ['Игра', 'Фильм', 'Сериал', 'Аниме', 'Другое'];
  res.status(200).json(categories);
}
