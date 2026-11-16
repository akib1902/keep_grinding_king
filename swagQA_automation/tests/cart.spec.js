const {test, expect} = require('@playwright/test');
const users = require('../data/users');
const LoginPage = require('../pages/loginPage');
const constants = require('../data/constants');
const Cart = require('../pages/cart');

let invetory;

test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page);
    const inventory = new Inventory(page);

    await loginPage.open();
    await loginPage.login(users.standardUser.userName, users.standardUser.password);
});

test('added product appear correctly in cart', async ({ page }) => {
    inventory.addProductToCart(constants.text.sauceLabsBackpack);
    inventory.addProductToCart(constants.text.sauceLabBikelightText);
    await this.Cart.goToCart();
    
    cart.clickOnCheckout();
    cart.fillInformation(constants.text.firstName, constants.text.lastName, constants.text.postalCode);
    cart.continueOverview();

    const subtotal = await cart.getSubTotal();
    const tax = await cart.getTax();
    const total = await cart.getTotal();

    epect(total).toBeCloseTo(subtotal + tax, 2);

});