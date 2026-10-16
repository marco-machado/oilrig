import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';

// Opt-in (SHOTS=1): exact-size verification captures, plus a side-by-side with the
// reference image. Output goes to docs/screenshots.
test.skip(!process.env.SHOTS, 'set SHOTS=1 to run');
test.use({ viewport: { width: 1536, height: 1024 }, deviceScaleFactor: 1 });

const OUT = path.resolve('docs/screenshots');
const SUMMER = 'date=2026-12-21';
const SHOTS: Array<[string, string]> = [
  ['reference-view', `cam=ref&${SUMMER}&hour=8.4&weather=fair`],
  ['north-noon', `cam=refn&${SUMMER}&hour=12&weather=fair`],
  ['golden-hour', `cam=aerial&${SUMMER}&hour=18.3&weather=clear`],
  ['night-terrace', `cam=deck&${SUMMER}&hour=22&weather=clear`],
  ['storm', `cam=refn&${SUMMER}&hour=14&weather=storm`],
  ['fog', `cam=aerial&${SUMMER}&hour=9&weather=fog`],
  ['interior', `cam=interior&${SUMMER}&hour=10&weather=fair`],
  ['helipad', `cam=helipad&${SUMMER}&hour=16&weather=fair`],
  ['swim-platform', `cam=swim&${SUMMER}&hour=11&weather=clear&wind=5`],
  ['lower-walkway', `cam=walkway&${SUMMER}&hour=10&weather=fair`],
  ['living-room', `cam=living&${SUMMER}&hour=10&weather=fair`],
  ['doors', `cam=doors&${SUMMER}&hour=18.6&weather=clear`],
  ['elevator', `cam=elevator&${SUMMER}&hour=16&weather=fair`],
  ['elevator-from-landing', `cam=lift&${SUMMER}&hour=15&weather=fair`],
  ['firepit-lounge', `cam=lounge&${SUMMER}&hour=19.4&weather=clear`],
  ['hammock-nets', `cam=hammocks&${SUMMER}&hour=10&weather=fair`],
  ['tender', `cam=tender&${SUMMER}&hour=10&weather=fair`],
  ['drone-landing', `cam=pad&${SUMMER}&hour=16&weather=fair&drone=descend&droneT=14`],
  ['drone-parked', `cam=drone3q&${SUMMER}&hour=17.5&weather=fair&drone=landed&droneT=60`],
  ['drone-side', `cam=drone&${SUMMER}&hour=11&weather=fair&drone=landed&droneT=60`],
];

test.describe.configure({ mode: 'serial' });

for (const [name, query] of SHOTS) {
  test(`capture ${name}`, async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    await page.goto(`/?offline&q=high&${query}`);
    await page.waitForFunction(() => (window as any).__oceanHome?.stats.frames > 30, undefined, { timeout: 60_000 });
    await page.waitForTimeout(7000); // exposure adaptation, probe bake, temporal AA
    await page.addStyleTag({ content: '.hud{display:none!important}' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  });
}

test('side-by-side with the reference', async ({ page }) => {
  const ref = readFileSync(path.resolve('Single Deck Offshore Platform Structure.png')).toString('base64');
  const ours = readFileSync(path.join(OUT, 'reference-view.png')).toString('base64');
  await page.setViewportSize({ width: 3072, height: 1104 });
  await page.setContent(`<body style="margin:0;background:#111;color:#eee;font:20px system-ui;display:flex;flex-direction:column">
    <div style="display:flex">
      <img src="data:image/png;base64,${ref}" style="width:1536px;height:1024px;object-fit:cover">
      <img src="data:image/png;base64,${ours}" style="width:1536px;height:1024px">
    </div>
    <div style="display:flex;height:80px;align-items:center"><div style="width:1536px;text-align:center">Reference</div><div style="width:1536px;text-align:center">Ocean Home (High, 1536×1024, cam=ref)</div></div>
  </body>`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'compare-reference.png') });
});
