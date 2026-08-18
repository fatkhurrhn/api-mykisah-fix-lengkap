// index2.js
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

// Konfigurasi
const BASE_URL = 'https://kuramanime.ing';

// ============================================================
// ENDPOINT: /anime/latest (Versi CEPAT tanpa Puppeteer)
// ============================================================
app.get('/anime/latest', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        
        console.log(`📡 Fetching /quick/ongoing?order_by=updated&page=${page}`);
        
        const url = `${BASE_URL}/quick/ongoing?order_by=updated&page=${page}`;
        const result = await scrapeOngoingPage(url);
        
        // Pagination info
        const pagination = {
            currentPage: page,
            totalPages: result.totalPages || 1,
            hasNext: result.hasNext || false,
            hasPrev: page > 1
        };
        
        // Limit hasil
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
// Fungsi Scraping PAKAI FETCH (CEPAT!) - Nama tetap scrapeOngoingPage
// ============================================================
async function scrapeOngoingPage(url) {
    const startTime = Date.now();
    
    console.log(`🚀 Scraping: ${url}`);
    
    try {
        // 1. Fetch HTML dengan fetch
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
                'Referer': 'https://kuramanime.ing/',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        // ============================================================
        // Ambil daftar anime
        // ============================================================
        const items = [];
        
        $('.product__item').each((i, el) => {
            const $el = $(el);
            
            // ============================================================
            // CARI LINK DETAIL
            // ============================================================
            let episodeUrl = '';
            let animeId = null;
            let slug = '';
            
            // 1. Cari dari .product__item__pic a
            const $picLink = $el.find('.product__item__pic a');
            if ($picLink.length) {
                episodeUrl = $picLink.attr('href') || '';
            }
            
            // 2. Jika kosong, cari dari .product__item__text h5 a
            if (!episodeUrl) {
                const $titleLink = $el.find('.product__item__text h5 a');
                if ($titleLink.length) {
                    episodeUrl = $titleLink.attr('href') || '';
                }
            }
            
            // 3. Jika masih kosong, cari dari a langsung
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
            
            // ============================================================
            // BERSIHKAN URL - HANYA PATH SAJA, TANPA DOMAIN
            // ============================================================
            if (episodeUrl) {
                const pathMatch = episodeUrl.match(/(\/anime\/\d+\/[^\/]+(?:\/episode\/\d+)?)/);
                if (pathMatch) {
                    episodeUrl = pathMatch[1];
                } else {
                    episodeUrl = episodeUrl.replace(/^https?:\/\/[^\/]+/, '');
                }
            }
            
            // Extract ID dan slug dari URL
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
            
            // ============================================================
            // BUAT URL DETAIL DENGAN CUSTOM FORMAT
            // ============================================================
            let detailUrl = '';
            if (animeId && slug) {
                detailUrl = `/anime/detail/${animeId}/${slug}`;
            } else if (animeId) {
                detailUrl = `/anime/detail/${animeId}`;
            }
            
            // ============================================================
            // BUAT URL EPISODE DENGAN CUSTOM FORMAT
            // ============================================================
            let customEpisodeUrl = '';
            if (episodeUrl) {
                customEpisodeUrl = episodeUrl.replace(/^\/anime\//, '/anime/watch/');
            }
            
            // ============================================================
            // Gambar
            // ============================================================
            const $pic = $el.find('.product__item__pic');
            let imageUrl = $pic.attr('data-setbg') || '';
            if (!imageUrl) {
                const style = $pic.attr('style') || '';
                const match = style.match(/url\(["']?(.*?)["']?\)/);
                if (match) {
                    imageUrl = match[1];
                }
            }
            
            // ============================================================
            // Episode info
            // ============================================================
            const $ep = $el.find('.ep span');
            const episodeText = $ep.text().trim() || '';
            
            const epMatch = episodeText.match(/Ep\s*(\d+)\s*\/\s*([\d?]+)/);
            const currentEpisode = epMatch ? parseInt(epMatch[1]) : null;
            const totalEpisode = epMatch ? (epMatch[2] === '?' ? null : parseInt(epMatch[2])) : null;
            
            // ============================================================
            // Type
            // ============================================================
            const $type = $el.find('.product__item__text ul a:first-child li');
            const type = $type.text().trim() || '';
            
            // ============================================================
            // Title
            // ============================================================
            const $title = $el.find('.product__item__text h5 a');
            const title = $title.text().trim() || '';
            
            // ============================================================
            // Push data (tanpa quality, comments, views)
            // ============================================================
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

        // ============================================================
        // Ambil pagination
        // ============================================================
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
    }
}

// ============================================================
// ENDPOINT: /anime/detail/:id/:slug?
// ============================================================
app.get('/anime/detail/:id/:slug?', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const animeId = req.params.id;
        const slug = req.params.slug || '';
        
        if (!animeId || !/^\d+$/.test(animeId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid anime ID. Must be a number.'
            });
        }
        
        const url = slug ? `${BASE_URL}/anime/${animeId}/${slug}` : `${BASE_URL}/anime/${animeId}`;
        
        console.log(`📡 Fetching anime detail: ${url}`);
        
        const result = await scrapeAnimeDetail(url, animeId);
        
        if (!result || !result.id) {
            return res.status(404).json({
                success: false,
                error: 'Anime not found'
            });
        }
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`⏱️ Detail selesai: ${duration} detik`);
        
        res.json({
            success: true,
            source: 'Kuramanime',
            duration: `${duration} seconds`,
            data: result
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
// Fungsi Scraping Detail Anime - FULL FETCH (NO PUPPETEER!)
// ============================================================
async function scrapeAnimeDetail(url, animeId) {
    console.log(`🚀 Fetching detail pakai FETCH...`);
    
    try {
        // ============================================================
        // 1. FETCH HALAMAN DETAIL
        // ============================================================
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
                'Referer': 'https://kuramanime.ing/'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        // ============================================================
        // 2. INFORMASI DASAR
        // ============================================================
        const title = $('.anime__details__title h3').text().trim() || 
                      $('title').text().replace(' - Kuramanime', '').trim();
        
        const altTitle = $('.anime__details__title span').text().trim() || '';
        
        const slugMatch = url.match(/\/anime\/(\d+)\/([^\/]+)/);
        const slug = slugMatch ? slugMatch[2] : '';

        // ============================================================
        // 3. SINOPIS
        // ============================================================
        let synopsis = '';
        const synopsisElement = $('#synopsisField');
        if (synopsisElement.length) {
            let synopsisText = synopsisElement.text().trim();
            synopsisText = synopsisText.replace(/LIHAT SEMUA ▼$/, '').trim();
            synopsis = synopsisText;
        } else {
            synopsis = $('.anime__details__text p').first().text().trim() || '';
        }

        // ============================================================
        // 4. GAMBAR & SKOR
        // ============================================================
        const image = $('.anime__details__pic').attr('data-setbg') || 
                      $('meta[property="og:image"]').attr('content') || '';
        
        const scoreText = $('.anime__details__pic .ep').text().trim().replace('★', '').trim();
        const score = scoreText ? parseFloat(scoreText) : null;

        // ============================================================
        // 5. INFO DETAIL (TANPA source, credit, quality, rating, views, comments)
        // ============================================================
        let studio = null;
        let status = null;
        let type = null;
        let totalEpisodes = null;
        let airDate = null;
        let season = null;
        let duration = null;
        let members = 0;
        let country = null;
        
        const genres = [];

        // ============================================================
        // 6. PARSE WIDGET
        // ============================================================
        let widgetItems = [];
        
        if ($('.anime__details__widget ul li').length > 0) {
            widgetItems = $('.anime__details__widget ul li');
        } else if ($('.anime__details__widget .row .col-lg-6 ul li').length > 0) {
            widgetItems = $('.anime__details__widget .row .col-lg-6 ul li');
        } else if ($('.anime__details__widget .row .col-md-6 ul li').length > 0) {
            widgetItems = $('.anime__details__widget .row .col-md-6 ul li');
        }
        
        widgetItems.each((i, el) => {
            const $el = $(el);
            
            let label = '';
            let value = '';
            
            const $labelSpan = $el.find('.col-3 span');
            if ($labelSpan.length) {
                label = $labelSpan.text().trim().replace(':', '');
            }
            
            if (!label) {
                const $labelSpan2 = $el.find('.col-4 span');
                if ($labelSpan2.length) {
                    label = $labelSpan2.text().trim().replace(':', '');
                }
            }
            
            if (!label) {
                const text = $el.text().trim();
                const parts = text.split(':');
                if (parts.length >= 2) {
                    label = parts[0].trim();
                    value = parts.slice(1).join(':').trim();
                }
            }
            
            if (!label) return;
            
            if (!value) {
                const $valueEl = $el.find('.col-9');
                if ($valueEl.length) {
                    value = $valueEl.text().trim();
                    
                    const link = $valueEl.find('a');
                    if (link.length) {
                        if (link.length > 1) {
                            const values = [];
                            link.each((i, l) => {
                                const text = $(l).text().trim();
                                if (text) values.push(text);
                            });
                            value = values.join(', ');
                        } else {
                            value = link.text().trim();
                        }
                    }
                } else {
                    const text = $el.text().trim();
                    const parts = text.split(':');
                    if (parts.length >= 2) {
                        value = parts.slice(1).join(':').trim();
                    }
                }
            }
            
            switch(label) {
                case 'Tipe':
                    type = value || null;
                    break;
                case 'Episode':
                    totalEpisodes = value || null;
                    break;
                case 'Status':
                    status = value || null;
                    break;
                case 'Tayang':
                    airDate = value || null;
                    break;
                case 'Musim':
                    season = value || null;
                    break;
                case 'Durasi':
                    duration = value || null;
                    break;
                case 'Negara':
                    country = value || null;
                    break;
                case 'Studio':
                    const studioLink = $el.find('.col-9 a');
                    if (studioLink.length) {
                        const studioUrl = studioLink.attr('href') || '';
                        let customUrl = studioUrl.replace(/^https?:\/\/[^\/]+/, '');
                        customUrl = customUrl.replace(/^\/properties\/studio\//, '/anime/studio/');
                        
                        const studioNames = [];
                        studioLink.each((i, link) => {
                            const name = $(link).text().trim();
                            if (name) studioNames.push(name);
                        });
                        
                        studio = {
                            name: studioNames.join(', ') || studioLink.text().trim(),
                            url: customUrl || studioUrl
                        };
                    }
                    break;
                case 'Peminat':
                    members = parseInt(value.replace(/,/g, '')) || 0;
                    break;
                case 'Genre':
                case 'Demografis':
                case 'Tema':
                    const links = $el.find('.col-9 a');
                    links.each((i, link) => {
                        const text = $(link).text().trim();
                        const href = $(link).attr('href') || '';
                        if (text && text !== '') {
                            const cleanText = text.replace(/,/g, '').trim();
                            let customUrl = href.replace(/^https?:\/\/[^\/]+/, '');
                            customUrl = customUrl.replace(/^\/properties\/genre\//, '/anime/genre/');
                            if (!genres.find(g => g.name === cleanText)) {
                                genres.push({
                                    name: cleanText,
                                    url: customUrl || href
                                });
                            }
                        }
                    });
                    break;
                default:
                    break;
            }
        });

        // ============================================================
        // 7. AMBIL SEMUA EPISODE PAKAI FETCH (CEPAT!)
        // ============================================================
        console.log(`🚀 Mengambil episode pakai FETCH...`);
        const allEpisodes = [];
        let currentPage = 1;
        let hasMorePages = true;
        const fetchStartTime = Date.now();

        while (hasMorePages) {
            const episodePageUrl = `${url}?page=${currentPage}`;
            
            try {
                // Fetch HTML langsung (tanpa Puppeteer!)
                const epResponse = await fetch(episodePageUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
                        'Referer': 'https://kuramanime.ing/'
                    }
                });
                
                if (!epResponse.ok) {
                    console.log(`⚠️ Gagal fetch halaman ${currentPage}: ${epResponse.status}`);
                    hasMorePages = false;
                    break;
                }
                
                const epHtml = await epResponse.text();
                const $ep = cheerio.load(epHtml);
                
                // Ambil data-content dari HTML
                const popoverData = $ep('#episodeLists').attr('data-content');
                
                if (popoverData) {
                    const $popover = cheerio.load(popoverData);
                    
                    const episodeLinks = $popover('a.btn-danger');
                    
                    if (episodeLinks.length === 0) {
                        hasMorePages = false;
                        break;
                    }
                    
                    episodeLinks.each((i, el) => {
                        const href = $popover(el).attr('href');
                        const text = $popover(el).text().trim();
                        if (href && text && text.startsWith('Ep')) {
                            const exists = allEpisodes.some(e => e.episode === text);
                            if (!exists) {
                                let cleanUrl = href.replace(/^https?:\/\/[^\/]+/, '');
                                cleanUrl = cleanUrl.replace(/^\/anime\//, '/anime/watch/');
                                allEpisodes.push({
                                    episode: text,
                                    url: cleanUrl || href
                                });
                            }
                        }
                    });
                    
                    console.log(`✅ Halaman ${currentPage}: total ${allEpisodes.length} episode`);
                    
                    // Cek next page dari popover
                    const nextPageLink = $popover('.page__link__episode').filter((i, el) => {
                        const href = $popover(el).attr('href') || '';
                        return href.includes(`page=${currentPage + 1}`);
                    });
                    
                    if (nextPageLink.length > 0) {
                        currentPage++;
                        // Delay 300ms biar ga kena block
                        await new Promise(resolve => setTimeout(resolve, 300));
                        continue;
                    } else {
                        hasMorePages = false;
                    }
                } else {
                    hasMorePages = false;
                }
            } catch (error) {
                console.error(`❌ Gagal fetch halaman ${currentPage}:`, error.message);
                hasMorePages = false;
            }
        }

        const fetchDuration = ((Date.now() - fetchStartTime) / 1000).toFixed(2);
        console.log(`📺 Total ${allEpisodes.length} episode (fetch: ${fetchDuration} detik)`);

        // ============================================================
        // 8. SERIAL YANG BERHUBUNGAN (RELATED ANIME)
        // ============================================================
        const relatedAnime = [];
        
        $('.anime__details__review__related_anime .breadcrumb__links__v2').each((i, el) => {
            const $el = $(el);
            
            const $labelSpan = $el.find('.span__v2');
            let relationType = 'Related';
            
            if ($labelSpan.length) {
                const labelText = $labelSpan.text().trim();
                const labelMatch = labelText.match(/<b>(.*?)<\/b>/);
                if (labelMatch) {
                    relationType = labelMatch[1].trim();
                } else {
                    const cleanLabel = labelText.replace(/<[^>]*>/g, '').trim();
                    if (cleanLabel) {
                        relationType = cleanLabel;
                    }
                }
            }
            
            const $links = $el.find('a');
            $links.each((i, link) => {
                const href = $(link).attr('href');
                const name = $(link).text().trim();
                
                if (href && name) {
                    let relatedId = null;
                    const idMatch = href.match(/\/anime\/(\d+)/);
                    if (idMatch) {
                        relatedId = idMatch[1];
                    }
                    
                    let relatedSlug = '';
                    const slugMatch2 = href.match(/\/anime\/\d+\/([^\/]+)/);
                    if (slugMatch2) {
                        relatedSlug = slugMatch2[1];
                    }
                    
                    let customUrl = href.replace(/^https?:\/\/[^\/]+/, '');
                    customUrl = customUrl.replace(/^\/anime\//, '/anime/detail/');
                    
                    relatedAnime.push({
                        id: relatedId,
                        slug: relatedSlug,
                        title: name,
                        url: customUrl || href,
                        relation: relationType
                    });
                }
            });
        });

        // ============================================================
        // 9. COMPILE RESULT
        // ============================================================
        return {
            id: animeId,
            slug: slug,
            title: title,
            alternativeTitle: altTitle || null,
            synopsis: synopsis || null,
            image: image || null,
            score: score,
            type: type,
            status: status,
            totalEpisodes: totalEpisodes,
            airDate: airDate,
            season: season,
            duration: duration,
            country: country,
            studio: studio,
            genres: genres.length > 0 ? genres : null,
            members: members,
            episodes: allEpisodes.length > 0 ? allEpisodes : null,
            totalEpisodesCount: allEpisodes.length,
            relatedAnime: relatedAnime.length > 0 ? relatedAnime : null
        };

    } catch (error) {
        console.error('❌ Error scraping detail:', error.message);
        throw error;
    }
}











app.get('/anime/watch/:id/:slug/episode/:episode', async (req, res) => {
    try {
        const animeId = req.params.id;
        const slug = req.params.slug;
        const episode = req.params.episode;
        
        // Validasi
        if (!animeId || !/^\d+$/.test(animeId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid anime ID'
            });
        }
        
        if (!episode || !/^\d+$/.test(episode)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid episode number'
            });
        }
        
        const url = `${BASE_URL}/anime/${animeId}/${slug}/episode/${episode}`;
        console.log(`📡 Fetching episode: ${url}`);
        
        const result = await scrapeEpisode(url, animeId, slug, episode);
        
        if (!result || !result.streams || result.streams.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Episode not found or no stream available'
            });
        }
        
        res.json({
            success: true,
            source: 'Kuramanime',
            data: result
        });
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


async function scrapeEpisode(url, animeId, slug, episode) {
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
        
        // ============================================================
        // INTERCEPT NETWORK REQUESTS - AMBIL URL VIDEO
        // ============================================================
        const videoUrls = [];
        const m3u8Urls = [];
        
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const url = request.url();
            if (url.match(/\.(mp4|m3u8|webm)(\?|$)/i)) {
                if (url.includes('.mp4')) {
                    videoUrls.push(url);
                    console.log(`  🎬 Found MP4: ${url.substring(0, 100)}...`);
                }
                if (url.includes('.m3u8')) {
                    m3u8Urls.push(url);
                    console.log(`  📋 Found M3U8: ${url}`);
                }
            }
            request.continue();
        });

        // Navigasi
        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: 60000
        });

        // Tunggu video player
        try {
            await page.waitForSelector('video#player', { timeout: 15000 });
            console.log('✅ Video player ditemukan');
        } catch (e) {
            console.log('⚠️ Video player tidak ditemukan, mencoba selector lain...');
        }

        // Scroll
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 100;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if (totalHeight >= scrollHeight || totalHeight > 2000) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 100);
            });
        });

        await page.waitForTimeout(3000);

        // ============================================================
        // EKSTRAK DARI HTML
        // ============================================================
        const html = await page.content();
        const $ = cheerio.load(html);

        // Ambil semua source dari video
        const sources = [];
        $('video#player source').each((i, el) => {
            const src = $(el).attr('src');
            const size = $(el).attr('size') || 'auto';
            if (src && src.includes('.mp4')) {
                sources.push({
                    quality: size,
                    url: src
                });
            }
        });

        // Ambil direct src
        const directSrc = $('video#player').attr('src');
        if (directSrc && directSrc.includes('.mp4') && !sources.find(s => s.url === directSrc)) {
            sources.push({
                quality: 'auto',
                url: directSrc
            });
        }

        // ============================================================
        // AMBIL DARI NETWORK
        // ============================================================
        videoUrls.forEach(url => {
            if (!sources.find(s => s.url === url)) {
                let quality = 'auto';
                if (url.includes('720p')) quality = '720';
                else if (url.includes('480p')) quality = '480';
                else if (url.includes('360p')) quality = '360';
                else if (url.includes('1080p')) quality = '1080';
                
                sources.push({
                    quality: quality,
                    url: url
                });
            }
        });

        // ============================================================
        // AMBIL DARI SCRIPT EVALUATE
        // ============================================================
        const scriptData = await page.evaluate(() => {
            const data = {
                sources: [],
                poster: null
            };
            
            const video = document.querySelector('video#player');
            if (video) {
                data.poster = video.getAttribute('data-poster') || video.getAttribute('poster');
                
                const sources = video.querySelectorAll('source');
                sources.forEach(s => {
                    const src = s.src;
                    const size = s.getAttribute('size') || 'auto';
                    if (src && src.includes('.mp4')) {
                        data.sources.push({
                            quality: size,
                            url: src
                        });
                    }
                });
                
                if (video.src && video.src.includes('.mp4')) {
                    data.sources.push({
                        quality: 'auto',
                        url: video.src
                    });
                }
            }
            
            return data;
        });

        // Gabungkan dari script data
        scriptData.sources.forEach(s => {
            if (!sources.find(ex => ex.url === s.url)) {
                sources.push(s);
            }
        });

        // ============================================================
        // AMBIL INFO EPISODE
        // ============================================================
        const title = $('title').text().trim() || '';
        const animeTitle = $('.breadcrumb__links a').eq(2).text().trim() || '';
        
        // ============================================================
        // AMBIL LAST UPDATED
        // ============================================================
        let lastUpdated = null;
        let updatedBy = null;
        let updatedAt = null;
        
        // Cari dari .breadcrumb__links__v2 yang berisi info update
        $('.breadcrumb__links__v2').each((i, el) => {
            const $el = $(el);
            const text = $el.text().trim();
            
            // Cek apakah ini adalah elemen dengan info update
            if (text.includes('Terakhir diperbarui') || text.includes('terakhir diperbarui')) {
                // Cari span dengan icon clock
                const $span = $el.find('.span__v2');
                if ($span.length) {
                    const labelText = $span.text().trim();
                    if (labelText.includes('Terakhir diperbarui') || labelText.includes('terakhir diperbarui')) {
                        // Ambil seluruh teks
                        const fullText = $el.text().trim();
                        
                        // Parse: "Terakhir diperbarui pada? Minggu, 05 Jul 2026, 10:49:16 WIB (sekitar 2 hari yang lalu) oleh Sora."
                        // Cari pola tanggal
                        const dateMatch = fullText.match(/([A-Za-z]+,\s*\d{1,2}\s+[A-Za-z]+\s+\d{4},\s*\d{1,2}:\d{2}:\d{2}\s+[A-Za-z]+)/);
                        if (dateMatch) {
                            lastUpdated = dateMatch[1].trim();
                        }
                        
                        // Cari "oleh XXX"
                        const byMatch = fullText.match(/oleh\s+([^\s.]+)/);
                        if (byMatch) {
                            updatedBy = byMatch[1].trim();
                        }
                        
                        // Cari "sekitar X hari yang lalu"
                        const daysAgoMatch = fullText.match(/sekitar\s+([\d,]+)\s+hari\s+yang\s+lalu/);
                        if (daysAgoMatch) {
                            const daysAgo = daysAgoMatch[1].replace(/,/g, '');
                            // Jika ada, kita bisa simpan sebagai info tambahan
                            // updatedAt = `${daysAgo} hari yang lalu`;
                        }
                    }
                }
            }
        });
        
        // Jika tidak ditemukan dengan cara di atas, coba dengan selector langsung
        if (!lastUpdated) {
            // Cari elemen span yang mengandung teks "Terakhir diperbarui"
            $('span:contains("Terakhir diperbarui")').each((i, el) => {
                const $el = $(el);
                // Cari parent yang mengandung span tersebut
                const $parent = $el.closest('.breadcrumb__links__v2');
                if ($parent.length) {
                    const fullText = $parent.text().trim();
                    const dateMatch = fullText.match(/([A-Za-z]+,\s*\d{1,2}\s+[A-Za-z]+\s+\d{4},\s*\d{1,2}:\d{2}:\d{2}\s+[A-Za-z]+)/);
                    if (dateMatch) {
                        lastUpdated = dateMatch[1].trim();
                    }
                    const byMatch = fullText.match(/oleh\s+([^\s.]+)/);
                    if (byMatch) {
                        updatedBy = byMatch[1].trim();
                    }
                }
            });
        }
        
        // ============================================================
        // AMBIL DAFTAR EPISODE DENGAN CUSTOM URL
        // ============================================================
        const episodes = [];
        $('#animeEpisodes a.ep-button').each((i, el) => {
            const href = $(el).attr('href');
            const text = $(el).text().trim();
            const isActive = $(el).hasClass('active-ep');
            if (href) {
                // Bersihkan URL
                let cleanUrl = href.replace(/^https?:\/\/[^\/]+/, '');
                // Ganti /anime/ dengan /anime/watch/
                cleanUrl = cleanUrl.replace(/^\/anime\//, '/anime/watch/');
                episodes.push({
                    episode: text,
                    url: cleanUrl || href,
                    active: isActive || false
                });
            }
        });

        // ============================================================
        // AMBIL CREDIT
        // ============================================================
        const credit = $('#episodeCredit').text().trim() || '';

        // ============================================================
        // COMPILE RESULT
        // ============================================================
        return {
            animeId: animeId,
            slug: slug,
            episode: parseInt(episode),
            title: animeTitle,
            episodeTitle: title,
            credit: credit,
            poster: scriptData.poster || null,
            streams: sources.length > 0 ? sources : null,
            episodes: episodes.length > 0 ? episodes : null,
            totalEpisodes: episodes.length,
            lastUpdated: lastUpdated || null,
            updatedBy: updatedBy || null
        };

    } catch (error) {
        console.error('❌ Error scraping episode:', error.message);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
            console.log('🔒 Browser ditutup');
        }
    }
}


// ============================================================
// ENDPOINT: /anime/search
// ============================================================
app.get('/anime/search', async (req, res) => {
    try {
        const query = req.query.q || req.query.search || '';
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const orderBy = req.query.order_by || 'oldest';
        
        if (!query || query.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'Search query is required. Use ?q=keyword'
            });
        }
        
        const encodedQuery = encodeURIComponent(query.trim());
        const url = `${BASE_URL}/anime?order_by=${orderBy}&search=${encodedQuery}&page=${page}`;
        
        console.log(`📡 Searching: "${query}" (page ${page})`);
        
        const result = await scrapeSearchPage(url, query, page, orderBy);
        
        if (!result || !result.items || result.items.length === 0) {
            return res.json({
                success: true,
                source: 'Kuramanime',
                query: query,
                pagination: {
                    currentPage: page,
                    totalPages: 1,
                    hasNext: false,
                    hasPrev: page > 1
                },
                total: 0,
                data: []
            });
        }
        
        // Limit hasil
        const items = result.items.slice(0, limit);
        
        res.json({
            success: true,
            source: 'Kuramanime',
            query: query,
            orderBy: orderBy,
            pagination: {
                currentPage: page,
                totalPages: result.totalPages || 1,
                hasNext: result.hasNext || false,
                hasPrev: page > 1
            },
            total: items.length,
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
// Fungsi Scraping Search Page
// ============================================================
async function scrapeSearchPage(url, query, page, orderBy) {
    console.log(`🚀 Searching: ${url}`);
    
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

        // Tunggu konten
        try {
            await page.waitForSelector('.product__item', { timeout: 15000 });
        } catch (e) {
            // Jika tidak ada hasil, mungkin tidak ada anime ditemukan
            const noResult = await page.$('.no-result');
            if (noResult) {
                console.log('⚠️ Tidak ada hasil ditemukan');
                return {
                    items: [],
                    totalPages: 1,
                    currentPage: page,
                    hasNext: false
                };
            }
        }

        // Scroll
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

        // ============================================================
        // Ambil daftar anime hasil pencarian
        // ============================================================
        const items = [];
        
        $('.product__item').each((i, el) => {
            const $el = $(el);
            
            // CARI LINK DETAIL
            let episodeUrl = '';
            let animeId = null;
            let slug = '';
            
            // Cari dari .product__item__pic a
            const $picLink = $el.find('.product__item__pic a');
            if ($picLink.length) {
                episodeUrl = $picLink.attr('href') || '';
            }
            
            // Jika kosong, cari dari .product__item__text h5 a
            if (!episodeUrl) {
                const $titleLink = $el.find('.product__item__text h5 a');
                if ($titleLink.length) {
                    episodeUrl = $titleLink.attr('href') || '';
                }
            }
            
            // Jika masih kosong, cari dari a langsung
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
            
            // Bersihkan URL
            if (episodeUrl) {
                const pathMatch = episodeUrl.match(/(\/anime\/\d+\/[^\/]+(?:\/episode\/\d+)?)/);
                if (pathMatch) {
                    episodeUrl = pathMatch[1];
                } else {
                    episodeUrl = episodeUrl.replace(/^https?:\/\/[^\/]+/, '');
                }
            }
            
            // Extract ID dan slug
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
            
            // Buat URL detail
            let detailUrl = '';
            if (animeId && slug) {
                detailUrl = `/anime/${animeId}/${slug}`;
            } else if (animeId) {
                detailUrl = `/anime/${animeId}`;
            }
            
            // Gambar
            const $pic = $el.find('.product__item__pic');
            let imageUrl = $pic.attr('data-setbg') || '';
            if (!imageUrl) {
                const style = $pic.attr('style') || '';
                const match = style.match(/url\(["']?(.*?)["']?\)/);
                if (match) {
                    imageUrl = match[1];
                }
            }
            
            // Score
            let score = null;
            const scoreEl = $el.find('.ep .actual-anime-\\d+');
            if (scoreEl.length) {
                const scoreText = scoreEl.text().trim();
                if (scoreText && scoreText !== '?') {
                    score = parseFloat(scoreText) || null;
                }
            }
            
            // Episode info
            const epText = $el.find('.ep span.actual-anime-\\d+').first().text().trim() || '';
            let currentEpisode = null;
            let totalEpisode = null;
            
            // Coba dari class atau text
            const epSpan = $el.find('.ep span:not(.actual-anime-\\d+)');
            if (epSpan.length) {
                const epInfo = epSpan.text().trim();
                const epMatch = epInfo.match(/Ep\s*(\d+)\s*\/\s*([\d?]+)/);
                if (epMatch) {
                    currentEpisode = parseInt(epMatch[1]);
                    totalEpisode = epMatch[2] === '?' ? null : parseInt(epMatch[2]);
                }
            }
            
            // Type & Quality
            const $type = $el.find('.product__item__text ul a:first-child li');
            const $quality = $el.find('.product__item__text ul a:last-child li');
            const type = $type.text().trim() || '';
            const quality = $quality.text().trim() || '';
            
            // Title
            const $title = $el.find('.product__item__text h5 a');
            const title = $title.text().trim() || '';
            
            // Comments & Views
            let comments = 0;
            let views = 0;
            
            const $comments = $el.find('[class*="comments-count"]');
            if ($comments.length) {
                const text = $comments.text().trim().replace(/,/g, '');
                comments = parseInt(text) || 0;
            }
            
            const $views = $el.find('[class*="views-count"]');
            if ($views.length) {
                const text = $views.text().trim().replace(/,/g, '');
                views = parseInt(text) || 0;
            }
            
            items.push({
                id: animeId,
                title: title,
                url_detail: detailUrl,
                url_episode: episodeUrl || null,
                image: imageUrl,
                type: type,
                quality: quality,
                score: score,
                currentEpisode: currentEpisode,
                totalEpisode: totalEpisode,
                comments: comments,
                views: views
            });
        });

        // ============================================================
        // Ambil pagination
        // ============================================================
        let totalPages = 1;
        let hasNext = false;
        let currentPage = page;
        
        const pageLinks = $('.product__pagination a');
        pageLinks.each((i, el) => {
            const text = $(el).text().trim();
            if (text && !isNaN(text)) {
                const pageNum = parseInt(text);
                if (pageNum > totalPages) totalPages = pageNum;
            }
        });
        
        pageLinks.each((i, el) => {
            const html = $(el).html() || '';
            if (html.includes('fa-angle-right')) {
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

        console.log(`✅ Pencarian selesai! Dapat ${items.length} hasil`);

        return {
            items: items,
            totalPages: totalPages,
            currentPage: currentPage,
            hasNext: hasNext
        };

    } catch (error) {
        console.error('❌ Error searching:', error.message);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
            console.log('🔒 Browser ditutup');
        }
    }
}


// server-kuramanime.js - Tambahkan endpoint schedule

// ============================================================
// ENDPOINT: /schedule
// ============================================================
app.get('/schedule', async (req, res) => {
    try {
        const day = req.query.day || 'all';
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        
        // Validasi day
        const validDays = ['all', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'random'];
        if (!validDays.includes(day)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid day. Valid values: all, monday, tuesday, wednesday, thursday, friday, saturday, sunday, random'
            });
        }
        
        let url;
        if (day === 'all') {
            url = `${BASE_URL}/schedule?page=${page}`;
        } else {
            url = `${BASE_URL}/schedule?scheduled_day=${day}&page=${page}`;
        }
        
        console.log(`📡 Fetching schedule: ${url}`);
        
        const result = await scrapeSchedule(url, day, page);
        
        if (!result || !result.items || result.items.length === 0) {
            return res.json({
                success: true,
                source: 'Kuramanime',
                day: day,
                pagination: {
                    currentPage: page,
                    totalPages: 1,
                    hasNext: false,
                    hasPrev: page > 1
                },
                total: 0,
                data: []
            });
        }
        
        // Limit hasil
        const items = result.items.slice(0, limit);
        
        res.json({
            success: true,
            source: 'Kuramanime',
            day: day,
            pagination: {
                currentPage: page,
                totalPages: result.totalPages || 1,
                hasNext: result.hasNext || false,
                hasPrev: page > 1
            },
            total: items.length,
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

// server-kuramanime.js - Perbaiki fungsi scrapeSchedule

async function scrapeSchedule(url, day, page) {
    console.log(`🚀 Fetching schedule: ${url}`);
    
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

        // Tunggu konten
        try {
            await page.waitForSelector('.product__item', { timeout: 15000 });
        } catch (e) {
            console.log('⚠️ Tidak ada jadwal ditemukan');
            return {
                items: [],
                totalPages: 1,
                currentPage: page,
                hasNext: false
            };
        }

        // Scroll
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

        // ============================================================
        // Ambil daftar jadwal - PERBAIKAN
        // ============================================================
        const items = [];
        
        $('.product__item').each((i, el) => {
            const $el = $(el);
            
            // ============================================================
            // CARI LINK
            // ============================================================
            let detailUrl = '';
            let animeId = null;
            let slug = '';
            
            const $picLink = $el.find('.product__item__pic a');
            if ($picLink.length) {
                detailUrl = $picLink.attr('href') || '';
            }
            
            if (!detailUrl) {
                const $titleLink = $el.find('.product__item__text h5 a');
                if ($titleLink.length) {
                    detailUrl = $titleLink.attr('href') || '';
                }
            }
            
            if (detailUrl) {
                const pathMatch = detailUrl.match(/(\/anime\/\d+\/[^\/]+)/);
                if (pathMatch) {
                    detailUrl = pathMatch[1];
                } else {
                    detailUrl = detailUrl.replace(/^https?:\/\/[^\/]+/, '');
                }
            }
            
            if (detailUrl) {
                const idMatch = detailUrl.match(/\/anime\/(\d+)/);
                if (idMatch) {
                    animeId = idMatch[1];
                }
                
                const slugMatch = detailUrl.match(/\/anime\/\d+\/([^\/]+)/);
                if (slugMatch) {
                    slug = slugMatch[1];
                }
            }
            
            // ============================================================
            // GAMBAR
            // ============================================================
            const $pic = $el.find('.product__item__pic');
            let imageUrl = $pic.attr('data-setbg') || '';
            if (!imageUrl) {
                const style = $pic.attr('style') || '';
                const match = style.match(/url\(["']?(.*?)["']?\)/);
                if (match) {
                    imageUrl = match[1];
                }
            }
            
            // ============================================================
            // EPISODE INFO - PERBAIKAN
            // ============================================================
            let nextEpisode = null;
            let isFinished = false;
            
            // Cari semua span di dalam .ep
            const epSpans = $el.find('.ep span');
            
            epSpans.each((i, span) => {
                const text = $(span).text().trim();
                
                // Cek "Selanjutnya: Ep X"
                if (text.includes('Selanjutnya: Ep')) {
                    const match = text.match(/Selanjutnya:\s*Ep\s*(\d+)/);
                    if (match) {
                        nextEpisode = parseInt(match[1]);
                    }
                }
                
                // Cek "Sudah Selesai"
                if (text === 'Sudah Selesai') {
                    isFinished = true;
                }
            });
            
            // Cek dari class actual-schedule-ep
            const actualEp = $el.find('.actual-schedule-ep-\\d+');
            if (actualEp.length && !nextEpisode) {
                const text = actualEp.text().trim();
                if (text.includes('Selanjutnya: Ep')) {
                    const match = text.match(/Selanjutnya:\s*Ep\s*(\d+)/);
                    if (match) {
                        nextEpisode = parseInt(match[1]);
                    }
                }
            }
            
            // ============================================================
            // SCHEDULE INFO (Hari & Jam) - PERBAIKAN
            // ============================================================
            let scheduleDay = null;
            let scheduleTime = null;
            
            // Cara 1: Dari .view-end .actual-schedule-info-{id}
            const scheduleInfo = $el.find('.view-end .actual-schedule-info-\\d+');
            if (scheduleInfo.length >= 2) {
                const dayText = scheduleInfo.eq(0).text().trim();
                const timeText = scheduleInfo.eq(1).text().trim();
                if (dayText) scheduleDay = dayText;
                if (timeText) scheduleTime = timeText;
            }
            
            // Cara 2: Dari .view-end ul li
            if (!scheduleDay || !scheduleTime) {
                const viewEndLis = $el.find('.view-end ul li');
                viewEndLis.each((i, li) => {
                    const $li = $(li);
                    const icon = $li.find('i');
                    if (icon.length) {
                        const iconClass = icon.attr('class') || '';
                        const text = $li.find('span').text().trim();
                        
                        if (iconClass.includes('fa-calendar') && text) {
                            scheduleDay = text;
                        }
                        if (iconClass.includes('fa-clock') && text) {
                            scheduleTime = text;
                        }
                    }
                });
            }
            
            // Cara 3: Dari .view-end langsung (tanpa span)
            if (!scheduleDay || !scheduleTime) {
                const viewEndText = $el.find('.view-end').text().trim();
                // Coba parse "Senin 21:54 WIB"
                const match = viewEndText.match(/(Senin|Selasa|Rabu|Kamis|Jumat|Sabtu|Minggu)\s+(\d{2}:\d{2}\s*WIB)/);
                if (match) {
                    scheduleDay = match[1];
                    scheduleTime = match[2];
                }
            }
            
            // ============================================================
            // TYPE & QUALITY
            // ============================================================
            const $type = $el.find('.product__item__text ul a:first-child li');
            const $quality = $el.find('.product__item__text ul a:last-child li');
            const type = $type.text().trim() || '';
            const quality = $quality.text().trim() || '';
            
            // ============================================================
            // TITLE
            // ============================================================
            const $title = $el.find('.product__item__text h5 a');
            const title = $title.text().trim() || '';
            
            // ============================================================
            // PUSH DATA
            // ============================================================
            items.push({
                id: animeId,
                slug: slug,
                title: title,
                url_detail: detailUrl,
                image: imageUrl,
                type: type,
                quality: quality,
                schedule: {
                    day: scheduleDay,
                    time: scheduleTime
                },
                nextEpisode: nextEpisode,
                isFinished: isFinished
            });
        });

        // ============================================================
        // Ambil pagination
        // ============================================================
        let totalPages = 1;
        let hasNext = false;
        let currentPage = page;
        
        const pageLinks = $('.product__pagination a');
        pageLinks.each((i, el) => {
            const text = $(el).text().trim();
            if (text && !isNaN(text)) {
                const pageNum = parseInt(text);
                if (pageNum > totalPages) totalPages = pageNum;
            }
        });
        
        // Cek next page dari link terakhir
        const lastLink = pageLinks.last();
        if (lastLink.length) {
            const href = lastLink.attr('href') || '';
            const html = lastLink.html() || '';
            if (html.includes('fa-angle-right') || href.includes('page=')) {
                const nextMatch = href.match(/page=(\d+)/);
                if (nextMatch) {
                    const nextPage = parseInt(nextMatch[1]);
                    hasNext = nextPage > currentPage;
                } else {
                    hasNext = true;
                }
            }
        }

        console.log(`✅ Schedule selesai! Dapat ${items.length} jadwal`);

        return {
            items: items,
            totalPages: totalPages,
            currentPage: currentPage,
            hasNext: hasNext
        };

    } catch (error) {
        console.error('❌ Error fetching schedule:', error.message);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
            console.log('🔒 Browser ditutup');
        }
    }
}



// ============================================================
// Jalankan server
// ============================================================
app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('🚀 KURAMANIME API SERVER');
    console.log('='.repeat(60));
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log('');
    console.log('📌 ENDPOINTS:');
    console.log(`  GET /anime/latest?page=1&limit=20  - Daftar anime terbaru`);
    console.log(`  GET /anime/latest/detail/:id        - Detail anime + episode list`);
    console.log('='.repeat(60));
});

// Export untuk testing
export { scrapeOngoingPage, scrapeAnimeDetail };