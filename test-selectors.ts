import { chromium } from 'playwright-core';
import { load } from 'cheerio';

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  await page.goto('https://immobilien.derstandard.at/detail/14551553', { timeout: 30000 });
  await page.waitForTimeout(3000);

  const html = await page.content();
  const $ = load(html);

  console.log('=== BESCHREIBUNG TEST ===');
  console.log('section count:', $('section').length);

  $('section').each((i, el) => {
    const h2Text = $(el).find('h2').text().trim();
    if (h2Text) {
      console.log('Section', i, 'H2:', h2Text);
      if (h2Text === 'Beschreibung') {
        const paragraphs: string[] = [];
        $(el).find('p').each((j, p) => {
          paragraphs.push($(p).text().trim());
        });
        console.log('   Paragraphs:', paragraphs.length);
        console.log('   Text:', paragraphs.join(' ').substring(0, 200));
      }
    }
  });

  console.log('\n=== BILDER TEST ===');
  console.log('All img tags:', $('img').length);
  console.log('picture tags:', $('picture').length);
  console.log('picture source:', $('picture source').length);

  // Check srcset attributes
  $('picture source').slice(0, 3).each((i, el) => {
    console.log('Source', i, '- srcSet:', $(el).attr('srcSet')?.substring(0, 80));
  });

  console.log('\n=== TELEFON TEST ===');
  console.log('All a tags:', $('a').length);
  $('a').filter((i, el) => {
    const href = $(el).attr('href') || '';
    return href.includes('tel') || href.includes('phone');
  }).each((i, el) => {
    console.log('Link', i, ':', $(el).attr('href'), '-', $(el).text().trim());
  });

  await browser.close();
}

test().catch(console.error);
