// const {test, expect} = require('@playwright/test');
// const users = require('../data/users');
// const LoginPage = require('../pages/loginPage');
// const constants = require('../data/constants');
// const Cart = require('../pages/cart');

// let invetory;
// let cart;

// test.beforeEach(async ({ page }) => {
//     const loginPage = new LoginPage(page);
//     const inventory = new Inventory(page);

//     await loginPage.open();
//     await loginPage.login(users.standardUser.userName, users.standardUser.password);
// });

// test('added product appear correctly in cart', async ({ page }) => {
//     inventory.addProductToCart(constants.text.sauceLabsBackpack);
//     inventory.addProductToCart(constants.text.sauceLabBikelightText);
//     await this.Cart.goToCart();
    
//     cart.clickOnCheckout();
//     cart.fillInformation(constants.text.firstName, constants.text.lastName, constants.text.postalCode);
//     cart.continueOverview();

//     const subtotal = await cart.getSubTotal();
//     const tax = await cart.getTax();
//     const total = await cart.getTotal();

//     expect(total).toBeCloseTo(subtotal + tax, 2);

// });






// tests/cart.spec.js
const { test, expect } = require('@playwright/test');
const users = require('../data/users');
const { LoginPage } = require('../pages/loginPage');
const { Inventory } = require('../pages/inventory');
const { Cart } = require('../pages/cart');
const constants = require('../data/constants');

let inventory;
let cart;

test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page);
    inventory = new Inventory(page);
    cart = new Cart(page);

    await loginPage.open();
    await loginPage.login(users.standardUser.userName, users.standardUser.password);
});

test('added products appear correctly in cart', async () => {
    await inventory.addProductToCart(constants.text.sauceLabsBackpack);
    await inventory.addProductToCart(constants.text.sauceLabBikelightText);
    await cart.goToCart();

// tests/cart.spec.js
await cart.clickOnCheckout();
await cart.fillInformation(
    constants.checkout.firstName,
    constants.checkout.lastName,
    constants.checkout.postalCode
);
await cart.continueOverview();

    const subtotal = await cart.getSubTotal();
    const tax = await cart.getTax();
    const total = await cart.getTotal();

    expect(total).toBeCloseTo(subtotal + tax, 2);
});