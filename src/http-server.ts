import express from 'express';
import { chromium, Browser } from 'playwright';
import { googleSearch, getGoogleSearchPageHtml } from './search.js';
import logger from './logger.js';

const app = express();
const port = process.env.GOOGLE_SEARCH_PORT || 3000;

let browser: Browser;

app.use(express.json());

// 健康检查端点
app.get('/', (req, res) => {
  res.status(200).send('Google Search Server is running.');
});

// 搜索端点
app.get('/search', async (req, res) => {
  const query = req.query.q as string;
  if (!query) {
    return res.status(400).json({ error: 'Query parameter "q" is required.' });
  }

  try {
    const options = {
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 10,
      timeout: req.query.timeout ? parseInt(req.query.timeout as string, 10) : 60000,
      locale: req.query.locale as string || 'en-US',
      // 为简化，服务器模式不暴露所有CLI选项
    };

    logger.info({ query, options }, 'Received search request');
    const results = await googleSearch(query, options, browser);
    res.json(results);
  } catch (error) {
    logger.error({ err: error, query }, 'Search request failed');
    res.status(500).json({ error: 'An error occurred during the search.', message: error instanceof Error ? error.message : String(error) });
  }
});

// 获取HTML的端点
app.get('/get-html', async (req, res) => {
  const query = req.query.q as string;
  if (!query) {
    return res.status(400).json({ error: 'Query parameter "q" is required.' });
  }

  const saveHtml = req.query.saveHtml === 'true';

  try {
    const options = {
      timeout: req.query.timeout ? parseInt(req.query.timeout as string, 10) : 60000,
      locale: req.query.locale as string || 'zh-CN',
    };

    logger.info({ query, options, saveHtml }, 'Received get-html request');
    const htmlResult = await getGoogleSearchPageHtml(query, options, browser, saveHtml);

    // 为避免返回大量数据，只返回摘要信息
    const outputResult = {
      query: htmlResult.query,
      url: htmlResult.url,
      originalHtmlLength: htmlResult.originalHtmlLength,
      cleanedHtmlLength: htmlResult.html.length,
      savedPath: htmlResult.savedPath,
      screenshotPath: htmlResult.screenshotPath,
      htmlPreview: htmlResult.html.substring(0, 500) + (htmlResult.html.length > 500 ? '...' : '')
    };

    res.json(outputResult);
  } catch (error) {
    logger.error({ err: error, query }, 'Get-html request failed');
    res.status(500).json({ error: 'An error occurred while fetching HTML.', message: error instanceof Error ? error.message : String(error) });
  }
});

async function startServer() {
  logger.info('Launching shared browser instance for HTTP server...');
  browser = await chromium.launch({
    headless: process.env.NO_HEADLESS !== 'true', // 默认无头模式，可通过环境变量 NO_HEADLESS=true 禁用
    args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-features=IsolateOrigins,site-per-process",
          "--disable-site-isolation-trials",
          "--disable-web-security",
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--disable-gpu",
          "--hide-scrollbars",
          "--mute-audio",
          "--disable-background-networking",
          "--disable-background-timer-throttling",
          "--disable-backgrounding-occluded-windows",
          "--disable-breakpad",
          "--disable-component-extensions-with-background-pages",
          "--disable-extensions",
          "--disable-features=TranslateUI",
          "--disable-ipc-flooding-protection",
          "--disable-renderer-backgrounding",
          "--enable-features=NetworkService,NetworkServiceInProcess",
          "--force-color-profile=srgb",
          "--metrics-recording-only",
        ],
    ignoreDefaultArgs: ["--enable-automation"],
  });
  logger.info('Shared browser instance launched successfully.');

  app.listen(port, () => {
    logger.info(`HTTP server is listening on http://localhost:${port}`);
    logger.info('Endpoints:');
    logger.info('  - GET /search?q=<query>&limit=<number>&timeout=<number>&locale=<string>');
    logger.info('  - GET /get-html?q=<query>&saveHtml=true');
  });
}

async function shutdown() {
  logger.info('Shutting down server and closing browser...');
  if (browser) {
    await browser.close();
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startServer().catch(err => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});