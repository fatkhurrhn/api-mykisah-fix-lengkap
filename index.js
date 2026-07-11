// server-kuramanime.js - VERSI OPTIMASI LENGKAP
import express from 'express';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';
import cors from 'cors';
import NodeCache from 'node-cache';

// Gunakan stealth plugin
puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Konfigurasi
const BASE_URL = 'https://s1.kuramalink.app';

// ============================================================
// 1. CACHE CONFIGURATION
// ============================================================
const cache = new NodeCache({
    stdTTL: 30,          // Default 30 detik
    checkperiod: 10,
    useClones: false
});

// ============================================================
// 2. BROWSER INSTANCE (REUSE)
// ============================================================
let browserInstance = null;
let browserRefCount = 0;

async function getBrowser() {
    if (!browserInstance) {
        console.log('🚀 Launching browser (first time)...');
        browserInstance = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-software-rasterizer',
                '--disable-extensions',
                '--disable-setuid-sandbox',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-component-extensions-with-background-pages'
            ]
        });
    }
    browserRefCount++;
    return browserInstance;
}

async function releaseBrowser() {
    browserRefCount--;
    if (browserRefCount < 0) browserRefCount = 0;
}

// Tutup browser saat server shutdown
process.on('SIGTERM', async () => {
    if (browserInstance) {
        console.log('🔒 Closing browser...');
        await browserInstance.close();
        browserInstance = null;
    }
    process.exit(0);
});

process.on('SIGINT', async () => {
    if (browserInstance) {
        console.log('🔒 Closing browser...');
        await browserInstance.close();
        browserInstance = null;
    }
    process.exit(0);
});

// ============================================================
// 3. HELPER: SCRAPE DENGAN REUSE BROWSER
// ============================================================
async function scrapeWithBrowser(url, options = {}) {
    const {
        selector = '.product__item',
        waitUntil = 'domcontentloaded',
        timeout = 30000,
        scroll = true,
        scrollDistance = 1500,
        delay = 500
    } = options;

    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
        await page.setViewport({ width: 1280, height: 720 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            'Referer': 'https://kuramanime.ing/'
        });

        // Block resource yang tidak perlu
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (['image', 'font', 'media', 'stylesheet'].includes(resourceType)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        console.log(`🌐 Loading: ${url}`);
        await page.goto(url, {
            waitUntil: waitUntil,
            timeout: timeout
        });

        if (scroll) {
            await page.evaluate(async (distance) => {
                window.scrollBy(0, distance);
                await new Promise(resolve => setTimeout(resolve, 100));
            }, scrollDistance);
        }

        if (delay > 0) {
            await page.waitForTimeout(delay);
        }

        try {
            await page.waitForSelector(selector, { timeout: 5000 });
        } catch (e) {
            console.log(`⚠️ Selector "${selector}" not found, continuing...`);
        }

        const html = await page.content();
        return cheerio.load(html);

    } finally {
        await page.close();
        await releaseBrowser();
    }
}

// ============================================================
// 4. SCRAPE ONGOING PAGE (LATEST)
// ============================================================
async function scrapeOngoingPage(url) {
    console.log(`🚀 Scraping ongoing: ${url}`);

    const cacheKey = `ongoing_${url}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        console.log(`✅ Cache HIT untuk ${url}`);
        return cached;
    }

    try {
        const $ = await scrapeWithBrowser(url, {
            selector: '.product__item',
            waitUntil: 'domcontentloaded',
            timeout: 30000,
            scroll: true,
            scrollDistance: 1500,
            delay: 300
        });

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
            const $quality = $el.find('.product__item__text ul a:last-child li');
            const type = $type.text().trim() || '';
            const quality = $quality.text().trim() || '';
            
            const $title = $el.find('.product__item__text h5 a');
            const title = $title.text().trim() || '';
            
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
                url_episode: customEpisodeUrl,
                image: imageUrl,
                type: type,
                quality: quality,
                currentEpisode: currentEpisode,
                totalEpisode: totalEpisode,
                episodeInfo: episodeText,
                comments: comments,
                views: views
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

        const result = {
            items: items,
            totalPages: totalPages,
            currentPage: currentPage,
            hasNext: hasNext
        };

        cache.set(cacheKey, result, 30);
        console.log(`✅ Scraping selesai! Dapat ${items.length} anime (CACHED 30s)`);

        return result;

    } catch (error) {
        console.error('❌ Error scraping:', error.message);
        throw error;
    }
}

// ============================================================
// 5. SCRAPE ANIME DETAIL
// ============================================================
async function scrapeAnimeDetail(url, animeId) {
    console.log(`🚀 Scraping detail: ${url}`);
    
    const cacheKey = `detail_${animeId}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        console.log(`✅ Cache HIT untuk detail ${animeId}`);
        return cached;
    }

    try {
        const $ = await scrapeWithBrowser(url, {
            selector: '.anime__details__text',
            waitUntil: 'domcontentloaded',
            timeout: 30000,
            scroll: true,
            scrollDistance: 1500,
            delay: 300
        });

        const title = $('.anime__details__title h3').text().trim() || 
                      $('title').text().replace(' - Kuramanime', '').trim();
        
        const altTitle = $('.anime__details__title span').text().trim() || '';
        
        const slugMatch = url.match(/\/anime\/(\d+)\/([^\/]+)/);
        const slug = slugMatch ? slugMatch[2] : '';
        
        let synopsis = '';
        const synopsisElement = $('#synopsisField');
        if (synopsisElement.length) {
            let synopsisText = synopsisElement.text().trim();
            synopsisText = synopsisText.replace(/LIHAT SEMUA ▼$/, '').trim();
            synopsis = synopsisText;
        } else {
            synopsis = $('.anime__details__text p').first().text().trim() || '';
        }
        
        const image = $('.anime__details__pic').attr('data-setbg') || 
                      $('meta[property="og:image"]').attr('content') || '';
        
        const scoreText = $('.anime__details__pic .ep').text().trim().replace('★', '').trim();
        const score = scoreText ? parseFloat(scoreText) : null;
        
        const commentsText = $('[class*="comments-count"]').first().text().trim().replace(/,/g, '') || '0';
        const viewsText = $('[class*="views-count"]').first().text().trim().replace(/,/g, '') || '0';
        const comments = parseInt(commentsText) || 0;
        const views = parseInt(viewsText) || 0;
        
        let studio = null;
        let status = null;
        let type = null;
        let quality = null;
        let totalEpisodes = null;
        let airDate = null;
        let season = null;
        let duration = null;
        let rating = null;
        let members = 0;
        const genres = [];
        const themes = [];
        
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
                case 'Kualitas':
                    quality = value || null;
                    break;
                case 'Genre':
                    const genreLinks = $el.find('.col-9 a');
                    genreLinks.each((i, link) => {
                        const text = $(link).text().trim();
                        const href = $(link).attr('href') || '';
                        if (text && text !== '') {
                            const cleanText = text.replace(/,/g, '').trim();
                            let customUrl = href.replace(/^https?:\/\/[^\/]+/, '');
                            customUrl = customUrl.replace(/^\/properties\/genre\//, '/anime/genre/');
                            genres.push({
                                name: cleanText,
                                url: customUrl || href
                            });
                        }
                    });
                    break;
                case 'Tema':
                    const themeLinks = $el.find('.col-9 a');
                    themeLinks.each((i, link) => {
                        const text = $(link).text().trim();
                        const href = $(link).attr('href') || '';
                        if (text && text !== '') {
                            const cleanText = text.replace(/,/g, '').trim();
                            let customUrl = href.replace(/^https?:\/\/[^\/]+/, '');
                            customUrl = customUrl.replace(/^\/properties\/theme\//, '/anime/theme/');
                            themes.push({
                                name: cleanText,
                                url: customUrl || href
                            });
                        }
                    });
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
                case 'Rating':
                    rating = value || null;
                    break;
                default:
                    break;
            }
        });

        const episodes = [];
        
        const popoverContent = $('.popover-body');
        if (popoverContent.length) {
            popoverContent.find('a.btn-danger').each((i, el) => {
                const href = $(el).attr('href');
                const text = $(el).text().trim();
                if (href) {
                    let cleanUrl = href.replace(/^https?:\/\/[^\/]+/, '');
                    cleanUrl = cleanUrl.replace(/^\/anime\//, '/anime/watch/');
                    episodes.push({
                        episode: text,
                        url: cleanUrl || href
                    });
                }
            });
        }
        
        if (episodes.length === 0) {
            $('.anime__details__episodes .episode a.ep-button').each((i, el) => {
                const href = $(el).attr('href');
                const text = $(el).text().trim();
                const isActive = $(el).hasClass('active-ep');
                if (href) {
                    let cleanUrl = href.replace(/^https?:\/\/[^\/]+/, '');
                    cleanUrl = cleanUrl.replace(/^\/anime\//, '/anime/watch/');
                    const episodeObj = {
                        episode: text,
                        url: cleanUrl || href
                    };
                    if (isActive) {
                        episodeObj.active = true;
                    }
                    episodes.push(episodeObj);
                }
            });
        }
        
        if (episodes.length === 0) {
            const popoverData = $('[data-toggle="popover"]').first().attr('data-content');
            if (popoverData) {
                const $popover = cheerio.load(popoverData);
                $popover('a.btn-danger').each((i, el) => {
                    const href = $popover(el).attr('href');
                    const text = $popover(el).text().trim();
                    if (href) {
                        let cleanUrl = href.replace(/^https?:\/\/[^\/]+/, '');
                        cleanUrl = cleanUrl.replace(/^\/anime\//, '/anime/watch/');
                        episodes.push({
                            episode: text,
                            url: cleanUrl || href
                        });
                    }
                });
            }
        }

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
        
        if (relatedAnime.length === 0) {
            $('.anime__details__review__related_anime .breadcrumb__links__v2').each((i, el) => {
                const $el = $(el);
                const text = $el.text().trim();
                
                const relationMatch = text.match(/(Prekuel|Sekuel|Spin-off|Adaptasi|Lanjutan|Cerita Sampingan|Versi|OVA|Movie|Special|Episode|Musim|Terkait|Lainnya)\s*:\s*(.+)/i);
                if (relationMatch) {
                    const relationType = relationMatch[1].trim();
                    const animeText = relationMatch[2].trim();
                    
                    const $link = $el.find('a');
                    if ($link.length) {
                        const href = $link.attr('href');
                        const name = $link.text().trim();
                        
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
                    }
                }
            });
        }

        const result = {
            id: animeId,
            slug: slug,
            title: title,
            alternativeTitle: altTitle || null,
            synopsis: synopsis || null,
            image: image || null,
            score: score,
            type: type,
            status: status,
            quality: quality,
            totalEpisodes: totalEpisodes,
            airDate: airDate,
            season: season,
            duration: duration,
            rating: rating,
            studio: studio,
            genres: genres.length > 0 ? genres : null,
            themes: themes.length > 0 ? themes : null,
            stats: {
                views: views,
                comments: comments,
                members: members
            },
            episodes: episodes.length > 0 ? episodes : null,
            totalEpisodesCount: episodes.length,
            relatedAnime: relatedAnime.length > 0 ? relatedAnime : null
        };

        cache.set(cacheKey, result, 300); // Cache 5 menit untuk detail
        console.log(`✅ Detail scraping selesai! (CACHED 5 menit)`);

        return result;

    } catch (error) {
        console.error('❌ Error scraping detail:', error.message);
        throw error;
    }
}

// ============================================================
// 6. SCRAPE EPISODE
// ============================================================
async function scrapeEpisode(url, animeId, slug, episode) {
    console.log(`🚀 Scraping episode: ${url}`);
    
    const cacheKey = `episode_${animeId}_${episode}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        console.log(`✅ Cache HIT untuk episode ${animeId}-${episode}`);
        return cached;
    }

    let browser = null;
    try {
        browser = await getBrowser();
        const page = await browser.newPage();

        await page.setViewport({ width: 1280, height: 720 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            'Referer': 'https://kuramanime.ing/'
        });
        
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

        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        try {
            await page.waitForSelector('video#player', { timeout: 10000 });
            console.log('✅ Video player ditemukan');
        } catch (e) {
            console.log('⚠️ Video player tidak ditemukan');
        }

        await page.evaluate(async () => {
            window.scrollBy(0, 500);
            await new Promise(resolve => setTimeout(resolve, 200));
        });

        const html = await page.content();
        const $ = cheerio.load(html);

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

        const directSrc = $('video#player').attr('src');
        if (directSrc && directSrc.includes('.mp4') && !sources.find(s => s.url === directSrc)) {
            sources.push({
                quality: 'auto',
                url: directSrc
            });
        }

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

        scriptData.sources.forEach(s => {
            if (!sources.find(ex => ex.url === s.url)) {
                sources.push(s);
            }
        });

        const title = $('title').text().trim() || '';
        const animeTitle = $('.breadcrumb__links a').eq(2).text().trim() || '';
        
        let lastUpdated = null;
        let updatedBy = null;
        
        $('.breadcrumb__links__v2').each((i, el) => {
            const $el = $(el);
            const text = $el.text().trim();
            
            if (text.includes('Terakhir diperbarui') || text.includes('terakhir diperbarui')) {
                const $span = $el.find('.span__v2');
                if ($span.length) {
                    const labelText = $span.text().trim();
                    if (labelText.includes('Terakhir diperbarui') || labelText.includes('terakhir diperbarui')) {
                        const fullText = $el.text().trim();
                        
                        const dateMatch = fullText.match(/([A-Za-z]+,\s*\d{1,2}\s+[A-Za-z]+\s+\d{4},\s*\d{1,2}:\d{2}:\d{2}\s+[A-Za-z]+)/);
                        if (dateMatch) {
                            lastUpdated = dateMatch[1].trim();
                        }
                        
                        const byMatch = fullText.match(/oleh\s+([^\s.]+)/);
                        if (byMatch) {
                            updatedBy = byMatch[1].trim();
                        }
                    }
                }
            }
        });
        
        if (!lastUpdated) {
            $('span:contains("Terakhir diperbarui")').each((i, el) => {
                const $el = $(el);
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

        const episodes = [];
        $('#animeEpisodes a.ep-button').each((i, el) => {
            const href = $(el).attr('href');
            const text = $(el).text().trim();
            const isActive = $(el).hasClass('active-ep');
            if (href) {
                let cleanUrl = href.replace(/^https?:\/\/[^\/]+/, '');
                cleanUrl = cleanUrl.replace(/^\/anime\//, '/anime/watch/');
                episodes.push({
                    episode: text,
                    url: cleanUrl || href,
                    active: isActive || false
                });
            }
        });

        const credit = $('#episodeCredit').text().trim() || '';

        const result = {
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

        // Cache 1 jam untuk episode (jarang berubah)
        cache.set(cacheKey, result, 3600);
        console.log(`✅ Episode scraping selesai! (CACHED 1 jam)`);

        return result;

    } catch (error) {
        console.error('❌ Error scraping episode:', error.message);
        throw error;
    } finally {
        if (browser) {
            await releaseBrowser();
        }
    }
}

// ============================================================
// 7. SCRAPE SEARCH
// ============================================================
async function scrapeSearchPage(url, query, page, orderBy) {
    console.log(`🚀 Searching: ${url}`);
    
    const cacheKey = `search_${query}_${page}_${orderBy}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        console.log(`✅ Cache HIT untuk search "${query}"`);
        return cached;
    }

    try {
        const $ = await scrapeWithBrowser(url, {
            selector: '.product__item',
            waitUntil: 'domcontentloaded',
            timeout: 30000,
            scroll: true,
            scrollDistance: 1500,
            delay: 300
        });

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
            
            const $pic = $el.find('.product__item__pic');
            let imageUrl = $pic.attr('data-setbg') || '';
            if (!imageUrl) {
                const style = $pic.attr('style') || '';
                const match = style.match(/url\(["']?(.*?)["']?\)/);
                if (match) {
                    imageUrl = match[1];
                }
            }
            
            let score = null;
            const scoreEl = $el.find('.ep .actual-anime-\\d+');
            if (scoreEl.length) {
                const scoreText = scoreEl.text().trim();
                if (scoreText && scoreText !== '?') {
                    score = parseFloat(scoreText) || null;
                }
            }
            
            const epText = $el.find('.ep span.actual-anime-\\d+').first().text().trim() || '';
            let currentEpisode = null;
            let totalEpisode = null;
            
            const epSpan = $el.find('.ep span:not(.actual-anime-\\d+)');
            if (epSpan.length) {
                const epInfo = epSpan.text().trim();
                const epMatch = epInfo.match(/Ep\s*(\d+)\s*\/\s*([\d?]+)/);
                if (epMatch) {
                    currentEpisode = parseInt(epMatch[1]);
                    totalEpisode = epMatch[2] === '?' ? null : parseInt(epMatch[2]);
                }
            }
            
            const $type = $el.find('.product__item__text ul a:first-child li');
            const $quality = $el.find('.product__item__text ul a:last-child li');
            const type = $type.text().trim() || '';
            const quality = $quality.text().trim() || '';
            
            const $title = $el.find('.product__item__text h5 a');
            const title = $title.text().trim() || '';
            
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

        const result = {
            items: items,
            totalPages: totalPages,
            currentPage: currentPage,
            hasNext: hasNext
        };

        // Cache 5 menit untuk search (jarang berubah)
        cache.set(cacheKey, result, 300);
        console.log(`✅ Pencarian selesai! Dapat ${items.length} hasil (CACHED 5 menit)`);

        return result;

    } catch (error) {
        console.error('❌ Error searching:', error.message);
        throw error;
    }
}

// ============================================================
// 8. SCRAPE SCHEDULE
// ============================================================
async function scrapeSchedule(url, day, page) {
    console.log(`🚀 Fetching schedule: ${url}`);
    
    const cacheKey = `schedule_${day}_${page}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        console.log(`✅ Cache HIT untuk schedule ${day}`);
        return cached;
    }

    try {
        const $ = await scrapeWithBrowser(url, {
            selector: '.product__item',
            waitUntil: 'domcontentloaded',
            timeout: 30000,
            scroll: true,
            scrollDistance: 1500,
            delay: 300
        });

        const items = [];
        
        $('.product__item').each((i, el) => {
            const $el = $(el);
            
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
            
            const $pic = $el.find('.product__item__pic');
            let imageUrl = $pic.attr('data-setbg') || '';
            if (!imageUrl) {
                const style = $pic.attr('style') || '';
                const match = style.match(/url\(["']?(.*?)["']?\)/);
                if (match) {
                    imageUrl = match[1];
                }
            }
            
            let nextEpisode = null;
            let isFinished = false;
            
            const epSpans = $el.find('.ep span');
            
            epSpans.each((i, span) => {
                const text = $(span).text().trim();
                
                if (text.includes('Selanjutnya: Ep')) {
                    const match = text.match(/Selanjutnya:\s*Ep\s*(\d+)/);
                    if (match) {
                        nextEpisode = parseInt(match[1]);
                    }
                }
                
                if (text === 'Sudah Selesai') {
                    isFinished = true;
                }
            });
            
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
            
            let scheduleDay = null;
            let scheduleTime = null;
            
            const scheduleInfo = $el.find('.view-end .actual-schedule-info-\\d+');
            if (scheduleInfo.length >= 2) {
                const dayText = scheduleInfo.eq(0).text().trim();
                const timeText = scheduleInfo.eq(1).text().trim();
                if (dayText) scheduleDay = dayText;
                if (timeText) scheduleTime = timeText;
            }
            
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
            
            if (!scheduleDay || !scheduleTime) {
                const viewEndText = $el.find('.view-end').text().trim();
                const match = viewEndText.match(/(Senin|Selasa|Rabu|Kamis|Jumat|Sabtu|Minggu)\s+(\d{2}:\d{2}\s*WIB)/);
                if (match) {
                    scheduleDay = match[1];
                    scheduleTime = match[2];
                }
            }
            
            const $type = $el.find('.product__item__text ul a:first-child li');
            const $quality = $el.find('.product__item__text ul a:last-child li');
            const type = $type.text().trim() || '';
            const quality = $quality.text().trim() || '';
            
            const $title = $el.find('.product__item__text h5 a');
            const title = $title.text().trim() || '';
            
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

        const result = {
            items: items,
            totalPages: totalPages,
            currentPage: currentPage,
            hasNext: hasNext
        };

        // Cache 1 jam untuk schedule (jarang berubah)
        cache.set(cacheKey, result, 3600);
        console.log(`✅ Schedule selesai! Dapat ${items.length} jadwal (CACHED 1 jam)`);

        return result;

    } catch (error) {
        console.error('❌ Error fetching schedule:', error.message);
        throw error;
    }
}

// ============================================================
// 9. ENDPOINTS
// ============================================================

// ============================================================
// 9a. ENDPOINT: /anime/latest
// ============================================================
app.get('/anime/latest', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const forceRefresh = req.query.refresh === 'true';
        
        const url = `${BASE_URL}/quick/ongoing?order_by=updated&page=${page}`;
        
        let result;
        if (forceRefresh) {
            // Force refresh: hapus cache dulu
            const cacheKey = `ongoing_${url}`;
            cache.del(cacheKey);
            console.log(`🔄 Force refresh untuk ${url}`);
        }
        
        result = await scrapeOngoingPage(url);
        
        const pagination = {
            currentPage: page,
            totalPages: result.totalPages || 1,
            hasNext: result.hasNext || false,
            hasPrev: page > 1
        };
        
        const items = result.items.slice(0, limit);
        
        res.json({
            success: true,
            source: 'Kuramanime',
            url: url,
            pagination: pagination,
            total: items.length,
            data: items,
            cached: cache.get(`ongoing_${url}`) ? true : false,
            fetchedAt: new Date().toISOString()
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
// 9b. ENDPOINT: /anime/detail/:id/:slug?
// ============================================================
app.get('/anime/detail/:id/:slug?', async (req, res) => {
    try {
        const animeId = req.params.id;
        const slug = req.params.slug || '';
        const forceRefresh = req.query.refresh === 'true';
        
        if (!animeId || !/^\d+$/.test(animeId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid anime ID. Must be a number.'
            });
        }
        
        let url;
        if (slug) {
            url = `${BASE_URL}/anime/${animeId}/${slug}`;
        } else {
            url = `${BASE_URL}/anime/${animeId}`;
        }
        
        if (forceRefresh) {
            const cacheKey = `detail_${animeId}`;
            cache.del(cacheKey);
            console.log(`🔄 Force refresh untuk detail ${animeId}`);
        }
        
        console.log(`📡 Fetching anime detail: ${url}`);
        
        const result = await scrapeAnimeDetail(url, animeId);
        
        if (!result || !result.id) {
            return res.status(404).json({
                success: false,
                error: 'Anime not found'
            });
        }
        
        res.json({
            success: true,
            source: 'Kuramanime',
            data: result,
            cached: cache.get(`detail_${animeId}`) ? true : false,
            fetchedAt: new Date().toISOString()
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
// 9c. ENDPOINT: /anime/watch/:id/:slug/episode/:episode
// ============================================================
app.get('/anime/watch/:id/:slug/episode/:episode', async (req, res) => {
    try {
        const animeId = req.params.id;
        const slug = req.params.slug;
        const episode = req.params.episode;
        const forceRefresh = req.query.refresh === 'true';
        
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
        
        if (forceRefresh) {
            const cacheKey = `episode_${animeId}_${episode}`;
            cache.del(cacheKey);
            console.log(`🔄 Force refresh untuk episode ${animeId}-${episode}`);
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
            data: result,
            cached: cache.get(`episode_${animeId}_${episode}`) ? true : false,
            fetchedAt: new Date().toISOString()
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
// 9d. ENDPOINT: /anime/search
// ============================================================
app.get('/anime/search', async (req, res) => {
    try {
        const query = req.query.q || req.query.search || '';
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const orderBy = req.query.order_by || 'oldest';
        const forceRefresh = req.query.refresh === 'true';
        
        if (!query || query.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'Search query is required. Use ?q=keyword'
            });
        }
        
        const encodedQuery = encodeURIComponent(query.trim());
        const url = `${BASE_URL}/anime?order_by=${orderBy}&search=${encodedQuery}&page=${page}`;
        
        if (forceRefresh) {
            const cacheKey = `search_${query}_${page}_${orderBy}`;
            cache.del(cacheKey);
            console.log(`🔄 Force refresh untuk search "${query}"`);
        }
        
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
            data: items,
            cached: cache.get(`search_${query}_${page}_${orderBy}`) ? true : false,
            fetchedAt: new Date().toISOString()
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
// 9e. ENDPOINT: /schedule
// ============================================================
app.get('/schedule', async (req, res) => {
    try {
        const day = req.query.day || 'all';
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const forceRefresh = req.query.refresh === 'true';
        
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
        
        if (forceRefresh) {
            const cacheKey = `schedule_${day}_${page}`;
            cache.del(cacheKey);
            console.log(`🔄 Force refresh untuk schedule ${day}`);
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
            data: items,
            cached: cache.get(`schedule_${day}_${page}`) ? true : false,
            fetchedAt: new Date().toISOString()
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
// 10. CACHE MANAGEMENT ENDPOINTS
// ============================================================

// Clear semua cache
app.post('/cache/clear', (req, res) => {
    cache.flushAll();
    console.log('🧹 Cache cleared!');
    res.json({
        success: true,
        message: 'Cache cleared successfully'
    });
});

// Clear cache spesifik
app.post('/cache/clear/:key', (req, res) => {
    const key = req.params.key;
    const deleted = cache.del(key);
    console.log(`🧹 Cache key "${key}" ${deleted ? 'deleted' : 'not found'}`);
    res.json({
        success: true,
        deleted: deleted > 0,
        key: key
    });
});

// Lihat stats cache
app.get('/cache/stats', (req, res) => {
    res.json({
        success: true,
        stats: cache.getStats(),
        keys: cache.keys(),
        totalKeys: cache.keys().length
    });
});

// ============================================================
// 11. ROOT ENDPOINT
// ============================================================
app.get('/', (req, res) => {
    res.json({
        name: 'Kuramanime API',
        version: '2.0.0',
        status: 'running',
        endpoints: {
            '/anime/latest': 'GET - Latest anime (cached 30s)',
            '/anime/detail/:id/:slug?': 'GET - Anime detail (cached 5m)',
            '/anime/watch/:id/:slug/episode/:episode': 'GET - Episode stream (cached 1h)',
            '/anime/search': 'GET - Search anime (cached 5m)',
            '/schedule': 'GET - Schedule (cached 1h)',
            '/cache/stats': 'GET - Cache statistics',
            '/cache/clear': 'POST - Clear all cache',
            '/cache/clear/:key': 'POST - Clear specific cache'
        },
        query_params: {
            refresh: 'Force refresh (bypass cache)',
            page: 'Page number',
            limit: 'Items per page',
            day: 'Schedule day (all, monday, etc)',
            q: 'Search query'
        }
    });
});

// ============================================================
// 12. START SERVER
// ============================================================
app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('🚀 KURAMANIME API SERVER (OPTIMIZED v2.0)');
    console.log('='.repeat(60));
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log('');
    console.log('📊 CACHE CONFIGURATION:');
    console.log('  📌 /anime/latest     → 30 detik');
    console.log('  📌 /anime/detail     → 5 menit');
    console.log('  📌 /anime/watch      → 1 jam');
    console.log('  📌 /anime/search     → 5 menit');
    console.log('  📌 /schedule         → 1 jam');
    console.log('');
    console.log('📌 OPTIMASI:');
    console.log('  ✅ Reuse browser instance');
    console.log('  ✅ Smart cache dengan TTL berbeda');
    console.log('  ✅ Block resource tidak perlu');
    console.log('  ✅ Force refresh via ?refresh=true');
    console.log('  ✅ Cache management endpoints');
    console.log('');
    console.log('📌 ENDPOINTS:');
    console.log(`  GET  /                             - API Info`);
    console.log(`  GET  /anime/latest?page=1&limit=20 - Latest anime`);
    console.log(`  GET  /anime/detail/:id/:slug?      - Anime detail`);
    console.log(`  GET  /anime/watch/:id/:slug/episode/:episode - Watch episode`);
    console.log(`  GET  /anime/search?q=keyword       - Search anime`);
    console.log(`  GET  /schedule?day=all             - Schedule`);
    console.log(`  GET  /cache/stats                  - Cache stats`);
    console.log(`  POST /cache/clear                  - Clear cache`);
    console.log(`  POST /cache/clear/:key             - Clear specific cache`);
    console.log('='.repeat(60));
});

// Export untuk testing
export { 
    scrapeOngoingPage, 
    scrapeAnimeDetail, 
    scrapeEpisode,
    scrapeSearchPage,
    scrapeSchedule
};