export default async function handler(req, res) {
  const categories = ['Хоррор', 'Выживание', 'Инди', 'Мультиплеер', 'Сюжетная', 'Другое'];
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json(categories);
}
