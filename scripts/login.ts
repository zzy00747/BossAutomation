import { BrowserManager } from '../src/browser/manager.js';
import { BossAuthService } from '../src/platform/boss/auth.js';
import { getConfig } from '../src/config.js';

async function main() {
  const config = getConfig();
  const browserManager = new BrowserManager({
    cdpUrl: config.CDP_URL,
    chromePath: config.CHROME_PATH,
    headless: false,
  });
  const auth = new BossAuthService({ browserManager });

  try {
    const loggedIn = await auth.loginViaCDP();
    console.log(loggedIn ? '已登录 Boss 直聘' : '未登录，请先扫码或登录');
    console.log(`会话保存路径: data/session/boss.json`);
  } finally {
    await browserManager.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
