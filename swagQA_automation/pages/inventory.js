// class Inventory{
//     constructor(page){
//         this.inventoryItems = page.locator('[data-test="inventory-item"]');
//         this.cartBadge = page.locator('.shopping_cart_badge');
//         this.sortDropdown = page.locator('[data-test="product_sort_container"]');
//         this.itemPrices = page.locator('[data-test="inventory-item-price"]');
//     }

//     getProductCard(productName){
//         return this.inventoryItems.filter({ hasText: productName });
//     }

//     async addProductToCart(productName){
//         const product = this.getProductCard(productName);
//         await product.getByRole('button', {name: 'Add to cart'}).click();
//     }

//     async getCartBadgeCount(){
//         const hashBadge = await this.cartBadge.count();
//         if(hashBadge === 0) return 0;
//         return hashBadge;
//     }

//     async sortBy(optionvalue){
//         await this.sortDropdown.selectOption('[data-test="sort-menu"]', optionvalue);
//     }

//     async getAllProductPrices(){
//         const priceText = await this.itemPrices.allTextContents();
//         return pricesText.map(p => parseFloat(p.replace('$', '')));
//     }
// }
// module.exports = {Inventory};


// pages/inventory.js
class Inventory {
    constructor(page) {
        this.page = page;
        this.inventoryItems = page.locator('[data-test="inventory-item"]');
        this.cartBadge = page.locator('.shopping_cart_badge');
        this.sortDropdown = page.locator('[data-test="product-sort-container"]');
        this.itemPrices = page.locator('[data-test="inventory-item-price"]');
    }

    getProductCard(productName) {
        return this.inventoryItems.filter({ hasText: productName });
    }

    async addProductToCart(productName) {
        await this.getProductCard(productName)
            .getByRole('button', { name: 'Add to cart' })
            .click();
    }

    async getCartBadgeCount() {
        if ((await this.cartBadge.count()) === 0) return 0;
        const text = await this.cartBadge.textContent();
        return parseInt(text, 10);
    }

    async sortBy(optionValue) {
        await this.sortDropdown.selectOption(optionValue);
    }

    async getAllProductPrices() {
        const priceTexts = await this.itemPrices.allTextContents();
        return priceTexts.map((p) => parseFloat(p.replace('$', '')));
    }
}

module.exports = { Inventory };