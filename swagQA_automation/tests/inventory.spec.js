const {test, expect} = require('@playwright/test');
const {loginPage} = require('../pages/loginPage');
const {Inventory} = require('../pages/inventory');
const constants = require('../data/constants');

let inventory;

test.beforeEach(async ({ page }) => {
    loginPage = new loginPage(page);
    await loginPage.open();
});

test('cart badge updates when adding products', async ({ page }) => {
  inventory.addProductToCart(constants.text.sauceLabsBackpack);
  inventory.addProductToCart(constants.text.sauceLabBikelightText);
  const cartCount = await inventory.getCartBadgeCount();
  expect(cartCount).toBe(2);
});

test("products can be soted by low to high price", async ({ page }) => {
  inventory.sortBy(constants.sortOptions.priceAsc);  
  const prices = await inventory.getAllProductPrices();
  const sortedPrices = [...prices].sort((a, b) => a - b);
  expect(prices).toEqual(sortedPrices);
});