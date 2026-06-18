// =============================================
// 北海道機位托盤 - 主程式
// =============================================

const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const { exec } = require('child_process');
const config  = require('./config');

// ── Server 端代理 fetch GAS（追蹤重導向）──────
function fetchGas(url, cb, depth) {
  if ((depth || 0) > 5) return cb(new Error('重導向次數過多'));
  const https = require('https');
  https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
    if (res.statusCode === 301 || res.statusCode === 302) {
      return fetchGas(res.headers.location, cb, (depth || 0) + 1);
    }
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => cb(null, d));
  }).on('error', e => cb(e));
}

// ── 本機 HTTP Server（服務 popup.html）───────
let serverPort = 0;

function startServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const urlObj = new URL(req.url, `http://127.0.0.1`);

      if (urlObj.pathname === '/' || urlObj.pathname === '/popup') {
        // 服務 popup.html，注入本機 API 端點
        const tpl = fs.readFileSync(path.join(__dirname, 'popup.html'), 'utf8');
        const html = tpl
          .replace('__LOCAL_API__', `http://127.0.0.1:${serverPort}/api`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);

      } else if (urlObj.pathname === '/api') {
        // 代理端點：server 幫 fetch GAS，避免瀏覽器 CORS 問題
        const year  = urlObj.searchParams.get('year')  || new Date().getFullYear();
        const month = urlObj.searchParams.get('month') || new Date().getMonth() + 1;
        const gasUrl = `${config.GAS_URL}?action=getMonthSeats&key=${config.API_KEY}&year=${year}&month=${month}`;

        fetchGas(gasUrl, (err, data) => {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          if (err) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          } else {
            res.writeHead(200);
            res.end(data);
          }
        });

      } else if (urlObj.pathname === '/api/paid') {
        // 代理：取得付訂成行率資料
        const gasUrl = `${config.GAS_URL}?action=getPaidGroups&key=${config.API_KEY}`;
        fetchGas(gasUrl, (err, data) => {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          if (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
          else      { res.writeHead(200); res.end(data); }
        });

      } else {
        res.writeHead(404); res.end();
      }
    });
    server.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port;
      console.log(`伺服器啟動：http://127.0.0.1:${serverPort}`);
      resolve();
    });
  });
}

// ── 開啟 Chrome --app 彈出視窗 ───────────────
function openPopup() {
  const url = `http://127.0.0.1:${serverPort}/popup`;
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe',
  ];
  const chrome = candidates.find(p => fs.existsSync(p));

  if (chrome) {
    const { WINDOW_WIDTH: w, WINDOW_HEIGHT: h } = config;
    exec(`"${chrome}" --app=${url} --window-size=${w},${h}`);
  } else {
    exec(`start "" "${url}"`);
  }
}

// ── 托盤圖示（base64 PNG）────────────────────
function getIconBase64() {
  const iconPath = path.join(__dirname, 'icon.png');
  if (fs.existsSync(iconPath)) {
    return fs.readFileSync(iconPath).toString('base64');
  }
  return FALLBACK_ICON;
}

// 16x16 深藍底白色飛機圖示（PNG base64）
const FALLBACK_ICON =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAA' +
  'ATAAAAEwGtAiruAAAAbUlEQVQ4jWNgGAWkgv9E4P9IYP7/R8D/IMf/Acj/' +
  'gcD/gcD/gcD/gcD/gcD/gcD/gcD/gcD/gcD/gcD/gcD/gcD/gcD/gcD/gcD/' +
  'gcD/gcD/gcD/gcD/gcD/gcD/gcD/gcD/gcD/gcD/gcD/AAAA//8DAH+KBAOR' +
  'AQAAAABJRU5ErkJggg==';

// ── 啟動托盤 ─────────────────────────────────
function startTray() {
  let SysTray;
  try {
    SysTray = require('systray2').default;
    if (typeof SysTray !== 'function') SysTray = require('systray2');
  } catch (e) {
    console.error('找不到 systray2，請先執行：npm install');
    console.log(`\n手動開啟：http://127.0.0.1:${serverPort}/popup`);
    return;
  }

  const systray = new SysTray({
    menu: {
      icon: getIconBase64(),
      title: '北海道機位',
      tooltip: '北海道機位管理',
      items: [
        { title: '📊 查看機位狀態', tooltip: '開啟機位摘要視窗', checked: false, enabled: true },
        { title: '<SEPARATOR>' },
        { title: '↻ 開啟瀏覽器查看', tooltip: '用預設瀏覽器開啟', checked: false, enabled: true },
        { title: '<SEPARATOR>' },
        { title: '✕ 結束', tooltip: '關閉托盤程式', checked: false, enabled: true },
      ],
    },
    debug: false,
    copyDir: true,
  });

  systray.onClick(action => {
    switch (action.seq_id) {
      case 0: openPopup(); break;
      case 2: exec(`start "" "http://127.0.0.1:${serverPort}/popup"`); break;
      case 4:
        systray.kill(false);
        process.exit(0);
        break;
    }
  });

  // 自動重整：每隔 N 分鐘在 console 記錄（視窗會自己 fetch，不需要這裡主動推）
  setInterval(() => {
    console.log(`[${new Date().toLocaleTimeString()}] 定時記錄（視窗內建自動重整）`);
  }, config.REFRESH_MINUTES * 60 * 1000);

  console.log('托盤已啟動。右鍵托盤圖示可操作。');
}

// ── 入口 ─────────────────────────────────────
startServer().then(startTray);
