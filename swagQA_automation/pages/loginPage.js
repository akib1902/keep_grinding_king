class LoginPage {
    constructor(page) {
        this.page = page;
        this.baseURL = process.env.BASE_URL;
        this.usernameInput = page.getByPlaceholder('Username');
        this.passwordInput = page.getByPlaceholder('Password');
        this.loginButton = page.getByRole('button', { name: 'Login' });
    }

    async open(){
        await this.page.goto(process.env.BASE_URL);
        console.log(`Navigated to ${process.env.BASE_URL}`);
    }

    async login(username, password) {
        await this.usernameInput.fill(users.standardUser.userName);
        await this.passwordInput.fill(users.standardUser.password);
        await this.loginButton.click();
    }
}

module.exports = LoginPage;