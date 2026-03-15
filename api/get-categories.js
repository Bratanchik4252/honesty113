export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const categories = ['Хоррор', 'Выживание', 'Инди', 'Мультиплеер', 'Сюжетная', 'Другое'];
  res.status(200).json(categories);
}
