import { chromium } from 'playwright-core';
import { load } from 'cheerio';

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  await page.goto('https://immobilien.derstandard.at/detail/15007514');
  await page.waitForTimeout(3000);

  const html = await page.content();
  const $ = load(html);

  console.log('=== BESCHREIBUNG DETAILLIERT ===\n');

  // Test 1: .sc-truncatable-section-text
  const truncatable = $('.sc-truncatable-section-text');
  console.log('1. .sc-truncatable-section-text gefunden:', truncatable.length);
  
  if (truncatable.length > 0) {
    console.log('   HTML:', truncatable.html()?.substring(0, 200));
    
    const paragraphs: string[] = [];
    truncatable.find('p').each((_, p) => {
      const text = $(p).text().trim();
      if (text && text !== ' ') {
        paragraphs.push(text);
      }
    });
    
    console.log('   Paragraphs gefunden:', paragraphs.length);
    if (paragraphs.length > 0) {
      console.log('   Erster Paragraph:', paragraphs[0].substring(0, 100));
    }
  }

  // Test 2: Check if "PRIVATVERKAUF" is in text
  const bodyText = $('body').text().toLowerCase();
  console.log('\n2. PRIVAT-CHECK:');
  console.log('   "privatverkauf":', bodyText.includes('privatverkauf'));
  console.log('   "provisionsfrei":', bodyText.includes('provisionsfrei'));
  console.log('   "keine provision":', bodyText.includes('keine provision'));

  await browser.close();
}

test().catch(console.error);
