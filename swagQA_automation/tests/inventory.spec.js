const {test, expect} = require('@playwright/test');
const {loginPage} = require('../pages/loginPage');
const {Inventory} = require('../pages/inventory');
const constraints = require('../data/contrains');

let loginPage;
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