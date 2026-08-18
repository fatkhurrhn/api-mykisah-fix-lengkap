import express from 'express';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';
import cors from 'cors';

// Gunakan stealth plugin
puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const BASE_URL = 'https://kuramanime.ing';

// ============================================================
// ENDPOINT: /anime/latest (PAKE PUPPETEER)
// ============================================================
app.get('/anime/latest', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        
        console.log(`📡 Fetching /quick/ongoing?order_by=updated&page=${page}`);
        
        const url = `${BASE_URL}/quick/ongoing?order_by=updated&page=${page}`;
        const result = await scrapeOngoingPage(url);
        
        const pagination = {
            currentPage: page,
            totalPages: result.totalPages || 1,
            hasNext: result.hasNext || false,
            hasPrev: page > 1
        };
        
        const items = result.items.slice(0, limit);
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`⏱️ Total waktu: ${duration} detik`);
        
        res.json({
            success: true,
            creator: 'Anonymous',
            url: url,
            pagination: pagination,
            total: items.length,
            duration: `${duration} seconds`,
            data: items
        });
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// FUNGSI SCRAPING PAKAI PUPPETEER (TEMBUS CLOUDFLARE)
// ============================================================
async function scrapeOngoingPage(url) {
    const startTime = Date.now();
    console.log(`🚀 Scraping (Puppeteer): ${url}`);
    
    let browser = null;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--window-size=1920x1080'
            ]
        });

        const page = await browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            'Referer': 'https://kuramanime.ing/'
        });

        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: 60000
        });

        try {
            await page.waitForSelector('.product__item', { timeout: 30000 });
        } catch (e) {
            console.log('⚠️ Konten tidak ditemukan, mungkin kena challenge');
            await page.waitForTimeout(5000);
        }

        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 100;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if (totalHeight >= scrollHeight || totalHeight > 3000) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 100);
            });
        });

        await page.waitForTimeout(2000);

        const html = await page.content();
        const $ = cheerio.load(html);

        const items = [];
        
        $('.product__item').each((i, el) => {
            const $el = $(el);
            
            let episodeUrl = '';
            let animeId = null;
            let slug = '';
            
            const $picLink = $el.find('.product__item__pic a');
            if ($picLink.length) {
                episodeUrl = $picLink.attr('href') || '';
            }
            
            if (!episodeUrl) {
                const $titleLink = $el.find('.product__item__text h5 a');
                if ($titleLink.length) {
                    episodeUrl = $titleLink.attr('href') || '';
                }
            }
            
            if (!episodeUrl) {
                const $anyLink = $el.find('a');
                $anyLink.each((i, link) => {
                    const href = $(link).attr('href');
                    if (href && href.includes('/anime/')) {
                        episodeUrl = href;
                        return false;
                    }
                });
            }
            
            if (episodeUrl) {
                const pathMatch = episodeUrl.match(/(\/anime\/\d+\/[^\/]+(?:\/episode\/\d+)?)/);
                if (pathMatch) {
                    episodeUrl = pathMatch[1];
                } else {
                    episodeUrl = episodeUrl.replace(/^https?:\/\/[^\/]+/, '');
                }
            }
            
            if (episodeUrl) {
                const idMatch = episodeUrl.match(/\/anime\/(\d+)/);
                if (idMatch) {
                    animeId = idMatch[1];
                }
                
                const slugMatch = episodeUrl.match(/\/anime\/\d+\/([^\/]+)/);
                if (slugMatch) {
                    slug = slugMatch[1];
                }
            }
            
            let detailUrl = '';
            if (animeId && slug) {
                detailUrl = `/anime/detail/${animeId}/${slug}`;
            } else if (animeId) {
                detailUrl = `/anime/detail/${animeId}`;
            }
            
            let customEpisodeUrl = '';
            if (episodeUrl) {
                customEpisodeUrl = episodeUrl.replace(/^\/anime\//, '/anime/watch/');
            }
            
            const $pic = $el.find('.product__item__pic');
            let imageUrl = $pic.attr('data-setbg') || '';
            if (!imageUrl) {
                const style = $pic.attr('style') || '';
                const match = style.match(/url\(["']?(.*?)["']?\)/);
                if (match) {
                    imageUrl = match[1];
                }
            }
            
            const $ep = $el.find('.ep span');
            const episodeText = $ep.text().trim() || '';
            
            const epMatch = episodeText.match(/Ep\s*(\d+)\s*\/\s*([\d?]+)/);
            const currentEpisode = epMatch ? parseInt(epMatch[1]) : null;
            const totalEpisode = epMatch ? (epMatch[2] === '?' ? null : parseInt(epMatch[2])) : null;
            
            const $type = $el.find('.product__item__text ul a:first-child li');
            const type = $type.text().trim() || '';
            
            const $title = $el.find('.product__item__text h5 a');
            const title = $title.text().trim() || '';
            
            items.push({
                id: animeId,
                title: title,
                url_detail: detailUrl,
                url_episode: customEpisodeUrl,
                image: imageUrl,
                type: type,
                currentEpisode: currentEpisode,
                totalEpisode: totalEpisode,
                episodeInfo: episodeText
            });
        });

        let totalPages = 1;
        let hasNext = false;
        let currentPage = 1;
        
        const pageMatch = url.match(/page=(\d+)/);
        if (pageMatch) {
            currentPage = parseInt(pageMatch[1]);
        }
        
        const pageLinks = $('.product__pagination a');
        pageLinks.each((i, el) => {
            const text = $(el).text().trim();
            if (text && !isNaN(text)) {
                const pageNum = parseInt(text);
                if (pageNum > totalPages) totalPages = pageNum;
            }
        });
        
        pageLinks.each((i, el) => {
            const htmlContent = $(el).html() || '';
            if (htmlContent.includes('fa-angle-right')) {
                const href = $(el).attr('href') || '';
                if (href) {
                    const nextMatch = href.match(/page=(\d+)/);
                    if (nextMatch) {
                        const nextPage = parseInt(nextMatch[1]);
                        hasNext = nextPage > currentPage;
                    } else {
                        hasNext = true;
                    }
                }
            }
        });

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`✅ Scraping selesai! Dapat ${items.length} anime ⏱️ ${duration} detik`);

        return {
            items: items,
            totalPages: totalPages,
            currentPage: currentPage,
            hasNext: hasNext
        };

    } catch (error) {
        console.error('❌ Error scraping:', error.message);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
            console.log('🔒 Browser ditutup');
        }
    }
}

// ============================================================
// JALANKAN SERVER
// ============================================================
app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('🚀 KURAMANIME API SERVER');
    console.log('='.repeat(60));
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log('');
    console.log('📌 ENDPOINTS:');
    console.log(`  GET /anime/latest?page=1&limit=20  - Daftar anime terbaru`);
    console.log('='.repeat(60));
});