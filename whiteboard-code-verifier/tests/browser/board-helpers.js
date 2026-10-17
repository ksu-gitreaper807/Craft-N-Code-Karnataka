export async function selectWritingRegion(page) {
  const area = await page.locator('.canvas-container').boundingBox();
  await page.getByRole('button', { name: 'Select code and input', exact: true }).click();
  await page.mouse.move(area.x + area.width * .25, area.y + area.height * .30);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width * .78, area.y + area.height * .8, { steps: 12 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Pen: code', exact: true }).click();
}
