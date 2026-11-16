// const {test, expect} = require('@playwright/test');
// const {loginPage} = require('../pages/loginPage');
// const {Inventory} = require('../pages/inventory');
// const constants = require('../data/constants');

// let inventory;

// test.beforeEach(async ({ page }) => {
//     const loginPage = new LoginPage(page);
//     await loginPage.open();
// });

// test('cart badge updates when adding products', async ({ page }) => {
//   inventory.addProductToCart(constants.text.sauceLabsBackpack);
//   inventory.addProductToCart(constants.text.sauceLabBikelightText);
//   const cartCount = await inventory.getCartBadgeCount();
//   expect(cartCount).toBe(2);
// });

// test("products can be soted by low to high price", async ({ page }) => {
//   inventory.sortBy(constants.sortOptions.priceAsc);  
//   const prices = await inventory.getAllProductPrices();
//   const sortedPrices = [...prices].sort((a, b) => a - b);
//   expect(prices).toEqual(sortedPrices);
// });





// tests/inventory.spec.js
const { test, expect } = require('@playwright/test');
const users = require('../data/users');
const { LoginPage } = require('../pages/loginPage');
const { Inventory } = require('../pages/inventory');
const constants = require('../data/constants');

let inventory;

test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page);
    inventory = new Inventory(page);

    await loginPage.open();
    await loginPage.login(users.standardUser.userName, users.standardUser.password);
});

test('cart badge updates when adding products', async () => {
    await inventory.addProductToCart(constants.text.sauceLabsBackpack);
    await inventory.addProductToCart(constants.text.sauceLabBikelightText);

    await expect(inventory.cartBadge).toHaveText('2');
});

test('products can be sorted by low to high price', async () => {
    await inventory.sortBy(constants.sortOptions.priceAsc);
    const prices = await inventory.getAllProductPrices();
    const sortedPrices = [...prices].sort((a, b) => a - b);

    expect(prices).toEqual(sortedPrices);
});