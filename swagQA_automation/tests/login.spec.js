const {test, expect} = require('@playwright/test');
const users = require('../data/users');
const LoginPage = require('../pages/loginPage');

let loginPage;

test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await loginPage.open();
});

test('Login with valid credentials', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('Username').fill('standard_user');
    await page.getByPlaceholder('Password').fill('secret_sauce');
    await page.getByRole('button', { name: 'Login' }).click();

    await expect(page).toHaveURL('/inventory.html');
    await expect(page.locator('.title')).toHaveText('Products');
});