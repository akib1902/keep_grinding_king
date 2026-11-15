const {test, expect} = require('@playwright/test');
const users = require('../data/users');
const LoginPage = require('../pages/loginPage');
const constraints = require('../data/contrains');

let loginPage;

test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await loginPage.open();
});

test('Login with valid credentials', async ({ page }) => {
    await page.goto('/');

    await loginPage.login();

    await expect(page).toHaveURL(constraints.urls.inventory);
    await expect(page.locator('.title')).toHaveText(constraints.productTitle);
});