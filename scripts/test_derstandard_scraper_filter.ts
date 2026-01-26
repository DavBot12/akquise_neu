import 'dotenv/config';
import { load } from 'cheerio';
import fs from 'fs';
import { proxyRequest, rotateUserAgent } from '../server/services/scraper-utils';

async function testDerStandardScraperFilter() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 DerStandard Scraper Filter Test');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Fetch search page to get real listing URLs
  const searchUrl = 'https://immobilien.derstandard.at/suche/niederoesterreich/kaufen-wohnung';

  console.log(`🔍 Fetching search page: ${searchUrl}\n`);

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

        // Skip Neubau URLs
        if (!fullUrl.includes('/immobiliensuche/neubau/detail/')) {
          detailUrls.push(fullUrl);
        }
      }
    });

    // Get unique URLs
    const uniqueUrls = Array.from(new Set(detailUrls));
    console.log(`✅ Found ${uniqueUrls.length} unique listing URLs\n`);

    // Test first 10 listings
    const testUrls = uniqueUrls.slice(0, 10);

    let privateCount = 0;
    let commercialCount = 0;
    let uncertainCount = 0;

    for (const url of testUrls) {
      console.log(`\n🔍 Testing: ${url}`);

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
          console.log('  ❌ Could not extract data');
          uncertainCount++;
          continue;
        }

        const metaData = nextData.metaData;
        const advertiser = nextData.advertiser;
        const isPrivate = metaData?.isPrivateAd;

        console.log(`  isPrivateAd: ${isPrivate}`);
        console.log(`  Company: ${advertiser?.company?.name || advertiser?.contactPerson?.companyName || 'N/A'}`);
        console.log(`  Title: ${nextData.title?.substring(0, 60)}`);

        // Apply filter logic
        const $detail = load(detailHtml);
        const bodyText = $detail('body').text().toLowerCase();

        let result = '';

        if (isPrivate === false) {
          result = '❌ COMMERCIAL (isPrivateAd: false)';
          commercialCount++;
        } else if (isPrivate === true) {
          // Check for false positives
          if (bodyText.includes('provision: 3') || bodyText.includes('nettoprovision') || bodyText.includes('provisionsaufschlag')) {
            result = '❌ COMMERCIAL (isPrivateAd: true BUT has Commission)';
            commercialCount++;
          } else {
            const companyName = advertiser?.company?.name || advertiser?.contactPerson?.companyName;
            if (companyName) {
              const lower = companyName.toLowerCase();
              const commercialKeywords = [
                'gmbh', 'immobilien', 'makler', 'agentur', 'real estate',
                'partners', 'group', 'sivag', 'bauträger', 'immo', 'contract'
              ];

              if (commercialKeywords.some(kw => lower.includes(kw))) {
                result = `❌ COMMERCIAL (isPrivateAd: true BUT company: ${companyName})`;
                commercialCount++;
              } else {
                result = '✅ PRIVATE (isPrivateAd: true)';
                privateCount++;
              }
            } else {
              result = '✅ PRIVATE (isPrivateAd: true, no company)';
              privateCount++;
            }
          }
        } else {
          // isPrivateAd is null/undefined - apply other filters
          const companyName = advertiser?.company?.name || advertiser?.contactPerson?.companyName;
          if (companyName) {
            const lower = companyName.toLowerCase();
            const commercialKeywords = [
              'gmbh', 'immobilien', 'makler', 'agentur', 'real estate',
              'partners', 'group', 'sivag', 'bauträger', 'immo'
            ];

            if (commercialKeywords.some(kw => lower.includes(kw))) {
              result = `❌ COMMERCIAL (company: ${companyName})`;
              commercialCount++;
            } else if (lower === 'privat' || lower === 'private') {
              result = '✅ PRIVATE (company: Privat)';
              privateCount++;
            } else {
              // Check body text
              const commercialBodyKeywords = ['provision: 3', 'nettoprovision', 'provisionsaufschlag'];
              if (commercialBodyKeywords.some(kw => bodyText.includes(kw))) {
                result = '❌ COMMERCIAL (body: Provision)';
                commercialCount++;
              } else {
                const privateKeywords = [
                  'von privat', 'privatverkauf', 'ohne makler',
                  'privater verkäufer', 'verkaufe privat'
                ];
                if (privateKeywords.some(kw => bodyText.includes(kw))) {
                  result = '✅ PRIVATE (body: private keywords)';
                  privateCount++;
                } else {
                  result = '❌ UNCERTAIN (default block)';
                  uncertainCount++;
                }
              }
            }
          } else {
            result = '❌ UNCERTAIN (no isPrivateAd, no company)';
            uncertainCount++;
          }
        }

        console.log(`  ${result}`);

        // Small delay
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error: any) {
        console.log(`  ❌ Error: ${error.message}`);
        uncertainCount++;
      }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 Summary:');
    console.log(`  ✅ Private: ${privateCount}/${testUrls.length}`);
    console.log(`  ❌ Commercial: ${commercialCount}/${testUrls.length}`);
    console.log(`  ⚠️  Uncertain: ${uncertainCount}/${testUrls.length}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error: any) {
    console.log(`❌ Error: ${error.message}`);
  }
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

testDerStandardScraperFilter().catch(console.error);
