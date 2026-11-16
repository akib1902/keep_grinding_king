const {test, expect} = require('@playwright/test');
const users = require('../data/users');
const {LoginPage} = require('../pages/loginPage');
const constants = require('../data/constants');

/**@type {LoginPage} */
let loginPage;

test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await loginPage.open();
});

test('Login with valid credentials', async ({ page }) => {
    await page.goto('/');

    await loginPage.login();

    await expect(page).toHaveURL(constants.urls.inventory);
    await expect(page.locator('.title')).toHaveText(constants.text.productTitle);
});