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
    const loggedIn = await auth.loginWithQR();
    console.log(loggedIn ? '二维码登录成功' : '二维码登录失败');
    console.log(`会话保存路径: data/session/boss.json`);
  } finally {
    await browserManager.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
