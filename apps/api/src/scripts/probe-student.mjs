const pages = [
  'https://www.lbrce.ac.in/',
  'https://www.lbrce.ac.in/studentcorner_pages/central_library.php',
];
for (const url of pages) {
  const html = await (await fetch(url, { headers: { 'User-Agent': 'LBRCE-AI-Bot/1.0' } })).text();
  const hrefs = [...html.matchAll(/href="([^"]*student[^"]*)"/gi)].map((match) => match[1]).slice(0, 15);
  console.log('\n', url);
  console.log(hrefs.join('\n'));
}
