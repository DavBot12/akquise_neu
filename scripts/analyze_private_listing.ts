import axios from 'axios';
import { load } from 'cheerio';
import fs from 'fs';

const url = 'https://immobilien.derstandard.at/detail/15015102';

async function analyze() {
  const res = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });

  const html = res.data;
  const $ = load(html);

  // Extract __NEXT_DATA__
  const nextDataScript = $('script#__NEXT_DATA__').html();
  if (nextDataScript) {
    const nextData = JSON.parse(nextDataScript);

    const isPrivateAd = nextData?.props?.pageProps?.propertyDetail?.metaData?.isPrivateAd;
    const company = nextData?.props?.pageProps?.propertyDetail?.advertiser?.company;
    const contactPerson = nextData?.props?.pageProps?.propertyDetail?.advertiser?.contactPerson;
    const amenities = nextData?.props?.pageProps?.propertyDetail?.property?.amenities;
    const title = nextData?.props?.pageProps?.propertyDetail?.title;

    console.log('\n=== LISTING 15015102 ===');
    console.log('isPrivateAd:', isPrivateAd);
    console.log('Title:', title);
    console.log('\nCompany:', company);
    console.log('\nContact Person:', contactPerson);
    console.log('\nAmenities:', amenities);

    // Save full data
    fs.writeFileSync('derstandard_15015102_analysis.json', JSON.stringify({
      isPrivateAd,
      title,
      company,
      contactPerson,
      amenities
    }, null, 2));
  }
}

analyze().catch(console.error);
