import 'dotenv/config';
import { load } from 'cheerio';
import { proxyRequest, rotateUserAgent } from '../server/services/scraper-utils';

async function findPrivateListings() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔍 Searching for Private Listings');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const searchUrls = [
    'https://immobilien.derstandard.at/suche/niederoesterreich/kaufen-wohnung',
    'https://immobilien.derstandard.at/suche/niederoesterreich/kaufen-wohnung?p=2',
    'https://immobilien.derstandard.at/suche/wien/kaufen-wohnung',
    'https://immobilien.derstandard.at/suche/wien/kaufen-wohnung?p=2',
  ];

  let totalPrivate = 0;
  let totalCommercial = 0;
  let totalTested = 0;
  const privateUrls: string[] = [];

  for (const searchUrl of searchUrls) {
    console.log(`\n📄 Fetching: ${searchUrl.substring(0, 80)}...`);

    try {
      const res = await proxyRequest(searchUrl, '', {
        headers: {
          'User-Agent': rotateUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        timeout: 30000
      });

      const html = res.data as string;
      const $ = load(html);

      // Extract detail URLs
      const detailUrls: string[] = [];
      $('a[href*="/detail/"]').each((_, el) => {
        const href = $(el).attr('href');
        if (href) {
          const fullUrl = href.startsWith('http')
            ? href
            : `https://immobilien.derstandard.at${href.startsWith('/') ? '' : '/'}${href}`;

          if (!fullUrl.includes('/immobiliensuche/neubau/detail/')) {
            detailUrls.push(fullUrl);
          }
        }
      });

      const uniqueUrls = Array.from(new Set(detailUrls));
      console.log(`   Found ${uniqueUrls.length} listings`);

      // Test up to 15 per page
      const testUrls = uniqueUrls.slice(0, 15);

      for (const url of testUrls) {
        try {
          const detailRes = await proxyRequest(url, '', {
            headers: {
              'User-Agent': rotateUserAgent(),
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            timeout: 30000
          });

          const detailHtml = detailRes.data as string;
          const nextData = extractNextData(detailHtml);

          if (!nextData) {
            continue;
          }

          totalTested++;

          const metaData = nextData.metaData;
          const isPrivate = metaData?.isPrivateAd;

          if (isPrivate === true) {
            console.log(`   ✅ PRIVATE: ${url}`);
            console.log(`      Title: ${nextData.title?.substring(0, 60)}`);
            totalPrivate++;
            privateUrls.push(url);
          } else if (isPrivate === false) {
            totalCommercial++;
          }

          // Small delay
          await new Promise(resolve => setTimeout(resolve, 300));

        } catch (error: any) {
          // Skip errors
        }
      }

    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 Final Results:');
  console.log(`  Total tested: ${totalTested}`);
  console.log(`  ✅ Private: ${totalPrivate} (${((totalPrivate / totalTested) * 100).toFixed(1)}%)`);
  console.log(`  ❌ Commercial: ${totalCommercial} (${((totalCommercial / totalTested) * 100).toFixed(1)}%)`);

  if (privateUrls.length > 0) {
    console.log('\n🎯 Private Listing URLs:');
    for (const url of privateUrls) {
      console.log(`   ${url}`);
    }
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

function extractNextData(html: string): any | null {
  try {
    const pattern = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
    const matches = html.matchAll(pattern);

    let jsonStr: string | null = null;
    for (const match of matches) {
      if (match[1] && match[1].includes('propertyData')) {
        jsonStr = match[1];
        break;
      }
    }

    if (!jsonStr) return null;

    jsonStr = jsonStr.replace(/\\"/g, '"');
    jsonStr = jsonStr.replace(/\\\\/g, '\\');

    const propertyDataIdx = jsonStr.indexOf('"propertyData":');
    if (propertyDataIdx === -1) return null;

    const fromPropertyData = jsonStr.substring(propertyDataIdx);
    const openBraceIdx = fromPropertyData.indexOf('{');
    if (openBraceIdx === -1) return null;

    let braceCount = 0;
    let closeBraceIdx = -1;
    for (let i = openBraceIdx; i < fromPropertyData.length; i++) {
      if (fromPropertyData[i] === '{') braceCount++;
      if (fromPropertyData[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
          closeBraceIdx = i + 1;
          break;
        }
      }
    }

    if (closeBraceIdx === -1) return null;

    const propertyDataJson = fromPropertyData.substring(openBraceIdx, closeBraceIdx);
    const data = JSON.parse(propertyDataJson);

    return data;
  } catch (error: any) {
    return null;
  }
}

findPrivateListings().catch(console.error);
