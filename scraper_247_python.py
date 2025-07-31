#!/usr/bin/env python3
import asyncio
import aiohttp
import random
import time
import json
import logging
from datetime import datetime
from bs4 import BeautifulSoup
from typing import Dict, List, Optional, Callable
import re

class ContinuousWillhabenScraper:
    def __init__(self):
        self.session = None
        self.is_running = False
        self.current_cycle = 0
        self.found_listings = []
        
        # User agents für Rotation
        self.user_agents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ]
        
        # Alle Kategorien mit Privatverkauf-URLs
        self.categories = {
            'eigentumswohnung-wien': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?areaId=900&areaId=903&rows=25&SELLER_TYPE=PRIVATE&keyword=Privatverkauf',
            'eigentumswohnung-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?areaId=904&rows=25&SELLER_TYPE=PRIVATE&keyword=Privatverkauf',
            'grundstueck-wien': 'https://www.willhaben.at/iad/immobilien/grundstueck/grundstueck-angebote?areaId=900&areaId=903&rows=25&SELLER_TYPE=PRIVATE&keyword=Privatverkauf',
            'grundstueck-niederoesterreich': 'https://www.willhaben.at/iad/immobilien/grundstueck/grundstueck-angebote?areaId=904&rows=25&SELLER_TYPE=PRIVATE&keyword=Privatverkauf'
        }
        
        # Setup logging
        logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
        self.logger = logging.getLogger(__name__)

    async def start_247_scraping(self, progress_callback: Callable[[str], None]):
        """Startet den 24/7 kontinuierlichen Scraper"""
        if self.is_running:
            progress_callback("⚠️ 24/7 Scraper läuft bereits!")
            return
            
        self.is_running = True
        progress_callback("🚀 PYTHON 24/7 SCRAPER GESTARTET - Ultimative Performance!")
        
        # Erstelle Session
        connector = aiohttp.TCPConnector(limit=10, limit_per_host=5)
        timeout = aiohttp.ClientTimeout(total=30)
        self.session = aiohttp.ClientSession(connector=connector, timeout=timeout)
        
        try:
            await self.continuous_scan_loop(progress_callback)
        finally:
            await self.session.close()

    async def continuous_scan_loop(self, progress_callback: Callable[[str], None]):
        """Hauptschleife für kontinuierliches Scannen"""
        while self.is_running:
            self.current_cycle += 1
            
            try:
                progress_callback(f"🔄 PYTHON CYCLE {self.current_cycle} - Scanne alle Kategorien...")
                
                # Zufällige Kategorie-Reihenfolge
                categories_list = list(self.categories.items())
                random.shuffle(categories_list)
                
                for category_name, base_url in categories_list:
                    if not self.is_running:
                        break
                        
                    await self.scan_category(category_name, base_url, progress_callback)
                    
                    # Pause zwischen Kategorien (3-8 Minuten)
                    category_delay = random.randint(180, 480)
                    progress_callback(f"⏰ Pause: {category_delay//60}min bis nächste Kategorie")
                    await asyncio.sleep(category_delay)
                
                # Lange Pause zwischen Zyklen (20-45 Minuten)
                cycle_delay = random.randint(1200, 2700)
                progress_callback(f"💤 CYCLE COMPLETE - Pause {cycle_delay//60}min bis nächster Zyklus")
                await asyncio.sleep(cycle_delay)
                
            except Exception as e:
                progress_callback(f"❌ PYTHON ERROR Cycle {self.current_cycle}: {str(e)}")
                await asyncio.sleep(600)  # 10 Min bei Fehler

    async def scan_category(self, category_name: str, base_url: str, progress_callback: Callable[[str], None]):
        """Scannt eine einzelne Kategorie"""
        progress_callback(f"🔍 PYTHON SCAN: {category_name}")
        
        try:
            # Scanne erste 3 Seiten für bessere Abdeckung
            for page in range(1, 4):
                if not self.is_running:
                    break
                    
                url = f"{base_url}&page={page}"
                listings = await self.get_page_listings(url, category_name, progress_callback)
                
                progress_callback(f"📄 Seite {page}: {len(listings)} Listings in {category_name}")
                
                # Verarbeite alle gefundenen Listings
                for listing in listings:
                    if not self.is_running:
                        break
                        
                    # Speichere in Liste für spätere Verarbeitung
                    self.found_listings.append(listing)
                    progress_callback(f"💎 PYTHON FUND: {listing['title'][:50]} - €{listing['price']}")
                    
                    # Sanftes Delay zwischen Listings
                    await asyncio.sleep(random.randint(5, 12))
                
                # Pause zwischen Seiten
                await asyncio.sleep(random.randint(15, 30))
                
        except Exception as e:
            progress_callback(f"❌ PYTHON Category Error {category_name}: {str(e)}")

    async def get_page_listings(self, url: str, category_name: str, progress_callback: Callable[[str], None]) -> List[Dict]:
        """Extrahiert Listings von einer Seite"""
        headers = {
            'User-Agent': random.choice(self.user_agents),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        }
        
        try:
            async with self.session.get(url, headers=headers) as response:
                if response.status == 200:
                    html = await response.text()
                    return await self.parse_listings_page(html, category_name)
                elif response.status == 429:
                    progress_callback(f"⚠️ Rate limit - warte 60s")
                    await asyncio.sleep(60)
                    return []
                else:
                    progress_callback(f"❌ HTTP {response.status} für {url}")
                    return []
                    
        except Exception as e:
            progress_callback(f"❌ Request Error: {str(e)}")
            return []

    async def parse_listings_page(self, html: str, category_name: str) -> List[Dict]:
        """Parst Listings aus HTML"""
        soup = BeautifulSoup(html, 'html.parser')
        listings = []
        
        # Verschiedene Selektoren für Listing-Links
        link_selectors = [
            'a[href*="/iad/immobilien/d/"]',
            'a[data-testid*="result-item"]',
            '.result-item a'
        ]
        
        listing_urls = set()
        for selector in link_selectors:
            links = soup.select(selector)
            for link in links:
                href = link.get('href', '')
                if '/iad/immobilien/d/' in href:
                    if href.startswith('/'):
                        href = f"https://www.willhaben.at{href}"
                    listing_urls.add(href)
        
        # Verarbeite jede URL
        for url in listing_urls:
            listing = await self.extract_listing_details(url, category_name)
            if listing:
                listings.append(listing)
                
        return listings

    async def extract_listing_details(self, url: str, category_name: str) -> Optional[Dict]:
        """Extrahiert Details eines einzelnen Listings"""
        headers = {
            'User-Agent': random.choice(self.user_agents),
            'Referer': 'https://www.willhaben.at/iad/immobilien/',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
        
        try:
            async with self.session.get(url, headers=headers) as response:
                if response.status != 200:
                    return None
                    
                html = await response.text()
                soup = BeautifulSoup(html, 'html.parser')
                
                # Extrahiere Daten
                title = self.extract_title(soup)
                price = self.extract_price(soup)
                area = self.extract_area(soup)
                location = self.extract_location(soup)
                description = self.extract_description(soup)
                phone = self.extract_phone_number(html)
                
                # Prüfe auf Privatverkauf-Keywords
                text_content = soup.get_text().lower()
                private_keywords = [
                    'privatverkauf', 'privat verkauf', 'von privat', 
                    'privater verkäufer', 'doppelmarkler', 'ohne makler'
                ]
                
                is_private = any(keyword in text_content for keyword in private_keywords)
                
                if is_private and price > 0:
                    region = 'wien' if 'wien' in category_name else 'niederoesterreich'
                    listing_category = 'eigentumswohnung' if 'eigentumswohnung' in category_name else 'grundstueck'
                    eur_per_m2 = round(price / area) if area > 0 else 0
                    
                    return {
                        'title': title,
                        'price': price,
                        'area': area,
                        'location': location,
                        'url': url,
                        'description': description,
                        'phoneNumber': phone,
                        'category': listing_category,
                        'region': region,
                        'eur_per_m2': eur_per_m2,
                        'scraped_at': datetime.now().isoformat()
                    }
                    
        except Exception as e:
            return None
            
        return None

    def extract_title(self, soup: BeautifulSoup) -> str:
        selectors = ['[data-testid="ad-detail-ad-title"] h1', '.AdDetailTitle', 'h1']
        for selector in selectors:
            element = soup.select_one(selector)
            if element:
                return element.get_text().strip()
        return 'Unknown Title'

    def extract_price(self, soup: BeautifulSoup) -> int:
        selectors = ['[data-testid="ad-detail-ad-price"] span', '.AdDetailPrice', '.price-value']
        for selector in selectors:
            element = soup.select_one(selector)
            if element:
                price_text = re.sub(r'[^\d]', '', element.get_text())
                try:
                    return int(price_text)
                except ValueError:
                    continue
        return 0

    def extract_area(self, soup: BeautifulSoup) -> int:
        selectors = ['[data-testid="ad-detail-ad-properties"]', '.AdDetailProperties']
        for selector in selectors:
            element = soup.select_one(selector)
            if element:
                text = element.get_text()
                match = re.search(r'(\d+)\s*m²', text, re.IGNORECASE)
                if match:
                    return int(match.group(1))
        return 0

    def extract_location(self, soup: BeautifulSoup) -> str:
        selectors = ['[data-testid="ad-detail-ad-location"]', '.AdDetailLocation']
        for selector in selectors:
            element = soup.select_one(selector)
            if element:
                return element.get_text().strip()
        return 'Unknown Location'

    def extract_description(self, soup: BeautifulSoup) -> str:
        selectors = ['[data-testid="ad-detail-ad-description"] p', '.AdDescription-description']
        for selector in selectors:
            element = soup.select_one(selector)
            if element:
                return element.get_text().strip()
        return ''

    def extract_phone_number(self, html: str) -> Optional[str]:
        patterns = [
            r'(\+43|0043)[\s\-]?[1-9]\d{1,4}[\s\-]?\d{3,8}',
            r'0[1-9]\d{1,4}[\s\-]?\d{3,8}'
        ]
        
        for pattern in patterns:
            matches = re.findall(pattern, html)
            if matches:
                return re.sub(r'[\s\-]', '', matches[0])
        return None

    def stop_scraping(self):
        """Stoppt den 24/7 Scraper"""
        self.is_running = False

    def get_status(self) -> Dict:
        """Gibt aktuellen Status zurück"""
        return {
            'is_running': self.is_running,
            'current_cycle': self.current_cycle,
            'total_found': len(self.found_listings)
        }

    def get_recent_listings(self, limit: int = 50) -> List[Dict]:
        """Gibt die neuesten gefundenen Listings zurück"""
        return self.found_listings[-limit:] if self.found_listings else []

# Standalone Test
async def main():
    scraper = ContinuousWillhabenScraper()
    
    def progress_callback(message: str):
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {message}")
    
    # Starte 24/7 Scraper
    await scraper.start_247_scraping(progress_callback)

if __name__ == "__main__":
    asyncio.run(main())