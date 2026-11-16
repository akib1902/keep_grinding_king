class Inventory{
    constructor(page){
        this.inventoryItems = page.locator('[data-test="inventory-item"]');
        this.cartBadge = page.locator('.shopping_cart_badge');
        this.sortDropdown = page.locator('[data-test="product_sort_container"]');
        this.itemPrices = page.locator('[data-test="inventory-item-price"]');
    }

    getProductCard(productName){
        return this.inventoryItems.filter({ hasText: productName });
    }

    async addProductToCart(productName){
        const product = this.getProductCard(productName);
        await product.getByRole('button', {name: 'Add to cart'}).click();
    }

    async getCartBadgeCount(){
        const hashBadge = await this.cartBadge.count();
        if(hashBadge === 0) return 0;
        return hashBadge;
    }

    async sortBy(optionvalue){
        await this.sortDropdown.selectOption('[data-test="sort-menu"]', optionvalue);
    }

    async getAllProductPrices(){
        const priceText = await this.itemPrices.allTextContents();
        return pricesText.map(p => parseFloat(p.replace('$', '')));
    }
}
module.exports = {Inventory}