import { chromium } from 'playwright-core';
import { load } from 'cheerio';

async function inspect() {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  await page.goto('https://immobilien.derstandard.at/detail/14551553');
  await page.waitForTimeout(3000);

  const html = await page.content();
  const $ = load(html);

  // Find Beschreibung section and dump its HTML
  const descSection = $('section').filter((i, el) => {
    return $(el).find('h2').text().trim() === 'Beschreibung';
  });

  console.log('BESCHREIBUNG HTML:');
  console.log(descSection.html()?.substring(0, 800));

  // Check picture source attributes
  console.log('\n\nBILD SOURCE ATTRIBUTES:');
  const firstSource = $('picture source').first();
  const attrs = firstSource.get(0)?.attribs;
  console.log('Attributes:', Object.keys(attrs || {}));
  console.log('srcset (lowercase):', firstSource.attr('srcset'));
  console.log('srcSet (camelCase):', firstSource.attr('srcSet'));

  await browser.close();
}

inspect().catch(console.error);
