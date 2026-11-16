// class Cart{
//     constructor(){
//         this.cartlink = page.locator('data-test=shopping-cart-badge');
//         this.cartItem = page.locator('.cart_item');
//         this.itemNames = page.locator('[data-test="inventory-item-name"]');
//         this.checkOutButton = page.locator('[data-test="checkout"]');
//         this.firstName = page.locator('[data-test="firstName"]');
//         this.lastName = page.locator('[data-test="lastName"]');
//         this.postalCodeInput = page.locator('[data-test="postalCode"]');
//         this.continueOverviewButton = page.locator('[data-test="continue"]');
//         this.subTotal = page.locator('[data-test="subtotal-label"]');
//         this.tax = page.locator('[data-test="tax-label"]');
//         this.total = page.locator('[data-test="total-label"]');
//         this.finishButton = page.locator('[data-test="finish"]');
//     }

//     async goToCart(){
//         await this.cartlink.click();
//     }

//     async removeProduct(productName){
//         const item = this.cartItem(productName)
//         await item.getByRole('button', {name: 'Remove'}).click();
//     }

//     getCartItem(productName){
//         return this.cartItem.filter({ hasText: productName });
//     }

//     async getCartItemCount(){
//         return this.cartItem.count();
//     }

//     async clickOnCheckout(){
//         await this.checkOutButton.click();
//     }

//     async fillInformation(firstName, lastName, postalCode){
//         await this.firstName.fill(firstName);
//         await this.lastName.fill(lastName);
//         await this.postalCodeInput.fill(postalCode);
//     }

//     async continueOverview(){
//         this.continueOverviewButton.click();
//     }

//     async getSubTotal(){
//         const text = await this.subTotal.textContent();
//         return parseFloat(text.replace('tax: $', ''));
//     }

//     async getTax(){
//         const tax = await this.tax();
//         return parseFloat(tax.replace('tax: $', ''));
//     }
    
//     async getTotal(){
//         const total = await this.tax();
//         return parseFloat(total.replace('total: $', ''));
//     }

//     async clickFinishButton(){
//         await this.finishButton.click();
//     }

// }
// module.exports = Cart;


// pages/cart.js
class Cart {
    constructor(page) {
        this.page = page;
        this.cartLink = page.locator('[data-test="shopping-cart-link"]');
        this.cartItem = page.locator('.cart_item');
        this.itemNames = page.locator('[data-test="inventory-item-name"]');
        this.checkOutButton = page.locator('[data-test="checkout"]');
        this.firstName = page.locator('[data-test="firstName"]');
        this.lastName = page.locator('[data-test="lastName"]');
        this.postalCodeInput = page.locator('[data-test="postalCode"]');
        this.continueOverviewButton = page.locator('[data-test="continue"]');
        this.subTotal = page.locator('[data-test="subtotal-label"]');
        this.tax = page.locator('[data-test="tax-label"]');
        this.total = page.locator('[data-test="total-label"]');
        this.finishButton = page.locator('[data-test="finish"]');
    }

    async goToCart() {
        await this.cartLink.click();
    }

    getCartItem(productName) {
        return this.cartItem.filter({ hasText: productName });
    }

    async removeProduct(productName) {
        await this.getCartItem(productName)
            .getByRole('button', { name: 'Remove' })
            .click();
    }

    async getCartItemCount() {
        return this.cartItem.count();
    }

    async clickOnCheckout() {
        await this.checkOutButton.click();
    }

    async fillInformation(firstName, lastName, postalCode) {
        await this.firstName.fill(firstName);
        await this.lastName.fill(lastName);
        await this.postalCodeInput.fill(postalCode);
    }

    async continueOverview() {
        await this.continueOverviewButton.click();
    }

    async getSubTotal() {
        const text = await this.subTotal.textContent();
        return parseFloat(text.replace(/[^0-9.]/g, ''));
    }

    async getTax() {
        const text = await this.tax.textContent();
        return parseFloat(text.replace(/[^0-9.]/g, ''));
    }

    async getTotal() {
        const text = await this.total.textContent();
        return parseFloat(text.replace(/[^0-9.]/g, ''));
    }

    async clickFinishButton() {
        await this.finishButton.click();
    }
}

module.exports = { Cart };